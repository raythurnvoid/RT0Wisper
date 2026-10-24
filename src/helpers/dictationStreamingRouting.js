// The options every live dictation session sends to the main process. Mistral
// fixes the language and the word list when the session starts.
export function buildStreamingSessionOptions({ language, keyterms }) {
  return {
    language: language && language !== "auto" ? language : undefined,
    keyterms,
  };
}
