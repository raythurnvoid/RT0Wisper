// Mistral is the only speech-to-text provider. Shared by dictation, retry and
// upload, and loaded by the renderer and the main process alike (main uses
// dynamic import), so it uses erasable TypeScript syntax only.

// Mistral's upload limit.
export const MISTRAL_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

// Prefix-matched rather than registry-checked on purpose: this module loads in
// the packaged main process without the registry.
export function resolveMistralModel(configuredModel?: string): string {
  const trimmed = (configuredModel || "").trim();
  return trimmed.startsWith("voxtral-") ? trimmed : "voxtral-mini-transcribe-3-0";
}
