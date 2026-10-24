// Decides whether the recording start path must wait for the cloud STT config
// before opening the mic. The config only influences the start decision in the
// signed-in OpenWhispr-cloud path (shouldUseStreaming reads
// sttConfig.dictation.mode there); for a signed-out session the
// awaited fetch stalls on auth resolution for seconds and then changes
// nothing (#1673).
export function needsSttConfigBeforeStart(settings) {
  const s = settings || {};
  if (s.cloudTranscriptionMode !== "openwhispr") return false;
  return !!s.isSignedIn;
}
