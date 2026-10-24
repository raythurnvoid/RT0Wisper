const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const modulePath = require.resolve("../../src/helpers/appAudioMuter");
const originalLoad = Module._load;
const originalPlatform = process.platform;

function setPlatform(platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}
test.afterEach(() => {
  setPlatform(originalPlatform);
  Module._load = originalLoad;
});

// A long-lived helper: records each stdin write until the test ends it.
function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.written = [];
  child.stdin = new EventEmitter();
  child.stdin.write = (text) => child.written.push(text);
  return child;
}

// Loads a fresh muter singleton for `platform` with spawn and the logger stubbed.
function loadMuter(platform) {
  delete require.cache[modulePath];
  setPlatform(platform);
  const calls = [];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (parent?.filename !== modulePath) return originalLoad.call(this, request, parent, isMain);
    if (request === "./debugLogger") return { debug() {}, warn() {} };
    if (request === "child_process") {
      return {
        spawn: (cmd, args, options) => {
          const child = createFakeChild();
          calls.push({ cmd, args, options, child });
          return child;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return { muter: require(modulePath), calls };
}

function decodeScript(call) {
  return Buffer.from(call.args[call.args.indexOf("-EncodedCommand") + 1], "base64").toString(
    "utf16le"
  );
}

test("win32: unmute before any mute starts nothing", () => {
  const { muter, calls } = loadMuter("win32");

  assert.equal(muter.unmute(), false);
  assert.equal(calls.length, 0);
});

test("win32: one helper takes every command in order and skips our own process", () => {
  const { muter, calls } = loadMuter("win32");

  assert.equal(muter.mute(), true);
  assert.equal(muter.unmute(), true);
  assert.equal(muter.mute(), true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "powershell.exe");
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls[0].child.written, ["mute\n", "unmute\n", "mute\n"]);
  const ownName = path.parse(process.execPath).name;
  assert.ok(decodeScript(calls[0]).includes(`[AppMuter]::Mute('${ownName}')`));
});

test("win32: a helper that exited is replaced on the next mute", () => {
  const { muter, calls } = loadMuter("win32");

  muter.mute();
  calls[0].child.emit("exit", 1);
  assert.equal(muter.unmute(), false);
  muter.mute();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].child.written, ["mute\n"]);
});

test("other platforms never start the helper", () => {
  const { muter, calls } = loadMuter("darwin");

  assert.equal(muter.mute(), false);
  assert.equal(muter.unmute(), false);
  assert.equal(calls.length, 0);
});
