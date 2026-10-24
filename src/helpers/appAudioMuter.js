const { spawn } = require("child_process");
const path = require("path");
const debugLogger = require("./debugLogger");

// Windows Core Audio: every app that plays sound owns an audio session with
// its own mute flag (the per-app switch in the Volume Mixer).
const MUTER_SOURCE = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  int GetCount(out int count);
  int Item(int index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int GetAudioSessionControl(IntPtr groupingParam, int flags, out IntPtr control);
  int GetSimpleAudioVolume(IntPtr groupingParam, int flags, out IntPtr volume);
  int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
  int GetCount(out int count);
  int GetSession(int index, out IAudioSessionControl2 session);
}

[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int GetState(out int state);
  int GetDisplayName(out IntPtr name);
  int SetDisplayName(string name, ref Guid context);
  int GetIconPath(out IntPtr path);
  int SetIconPath(string path, ref Guid context);
  int GetGroupingParam(out Guid param);
  int SetGroupingParam(ref Guid param, ref Guid context);
  int RegisterAudioSessionNotification(IntPtr client);
  int UnregisterAudioSessionNotification(IntPtr client);
  int GetSessionIdentifier(out IntPtr id);
  int GetSessionInstanceIdentifier(out IntPtr id);
  int GetProcessId(out uint pid);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float level, ref Guid context);
  int GetMasterVolume(out float level);
  int SetMute(bool mute, ref Guid context);
  int GetMute(out bool mute);
}

public static class AppMuter {
  static readonly List<ISimpleAudioVolume> muted = new List<ISimpleAudioVolume>();

  // Skips our own sessions (start/stop cues) and sessions the user muted.
  public static int Mute(string ownName) {
    foreach (var s in Sessions()) {
      uint pid; s.GetProcessId(out pid);
      if (pid != 0 && string.Equals(Name(pid), ownName, StringComparison.OrdinalIgnoreCase)) continue;
      var v = (ISimpleAudioVolume)s;
      bool already; v.GetMute(out already);
      if (already) continue;
      var ctx = Guid.Empty;
      if (v.SetMute(true, ref ctx) == 0) muted.Add(v);
    }
    return muted.Count;
  }

  // Unmutes only what Mute muted.
  public static int Unmute() {
    int n = 0;
    foreach (var v in muted) {
      var ctx = Guid.Empty;
      try { if (v.SetMute(false, ref ctx) == 0) n++; } catch {}
    }
    muted.Clear();
    return n;
  }

  static string Name(uint pid) {
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }

  static IEnumerable<IAudioSessionControl2> Sessions() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDeviceCollection devices;
    // 0 = render (speakers), 1 = active devices only.
    enumerator.EnumAudioEndpoints(0, 1, out devices);
    int deviceCount; devices.GetCount(out deviceCount);
    var iid = typeof(IAudioSessionManager2).GUID;
    for (int d = 0; d < deviceCount; d++) {
      IMMDevice device; devices.Item(d, out device);
      object o; device.Activate(ref iid, 23, IntPtr.Zero, out o);
      IAudioSessionEnumerator sessions;
      ((IAudioSessionManager2)o).GetSessionEnumerator(out sessions);
      int count; sessions.GetCount(out count);
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 s; sessions.GetSession(i, out s);
        yield return s;
      }
    }
  }
}
`;

// Reads one command per line. stdin closes when the app quits or crashes,
// so the loop ends and the helper unmutes before it exits.
function buildScript(ownName) {
  const name = ownName.replace(/'/g, "''");
  return `
# Progress records would reach stderr as CLIXML noise.
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
${MUTER_SOURCE}
'@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    if ($line -eq 'mute') { $reply = "muted $([AppMuter]::Mute('${name}'))" }
    elseif ($line -eq 'unmute') { $reply = "unmuted $([AppMuter]::Unmute())" }
    else { $reply = "error unknown command" }
  } catch { $reply = "error $($_.Exception.Message)" }
  [Console]::Out.WriteLine($reply)
  [Console]::Out.Flush()
}
[void][AppMuter]::Unmute()
`.trim();
}

// Mutes other apps while dictating. One PowerShell helper stays alive, so the
// C# compiles once and each command takes a few ms. Commands go through stdin
// in order, so an unmute sent right after a mute still runs after it.
class AppAudioMuter {
  constructor() {
    this._child = null;
  }

  mute() {
    return this._send("mute");
  }

  unmute() {
    // Nothing can be muted before the helper exists.
    if (!this._child) return false;
    return this._send("unmute");
  }

  _send(command) {
    if (process.platform !== "win32") return false;
    const child = this._child || this._start();
    if (!child) return false;
    try {
      child.stdin.write(`${command}\n`);
      return true;
    } catch (err) {
      debugLogger.warn("App mute command failed", { command, error: err.message }, "media");
      return false;
    }
  }

  _start() {
    // "electron" in dev, the app name when packaged. Our own cues share it.
    const ownName = path.parse(process.execPath).name;
    const encoded = Buffer.from(buildScript(ownName), "utf16le").toString("base64");
    let child;
    try {
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
      );
    } catch (err) {
      debugLogger.warn("App mute helper failed to start", { error: err.message }, "media");
      return null;
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        debugLogger.debug("App mute helper", { reply: line }, "media");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      debugLogger.warn("App mute helper error", { stderr: text.trim().slice(0, 200) }, "media");
    });
    // A dead pipe must not crash the main process.
    child.stdin.on("error", () => {});
    const clear = () => {
      if (this._child === child) this._child = null;
    };
    child.on("error", (err) => {
      debugLogger.warn("App mute helper failed", { error: err.message }, "media");
      clear();
    });
    child.on("exit", clear);

    this._child = child;
    return child;
  }
}

module.exports = new AppAudioMuter();
