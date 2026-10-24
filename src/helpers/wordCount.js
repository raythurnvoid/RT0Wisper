// Counts the words in a dictation. CJK text has no spaces, so it is counted
// with Intl.Segmenter.

const CJK_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function countWhitespaceDelimitedWords(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function countSpokenWords(text) {
  const fallbackCount = countWhitespaceDelimitedWords(text);
  if (fallbackCount === 0 || !CJK_SCRIPT_PATTERN.test(text)) return fallbackCount;

  try {
    if (typeof Intl === "undefined" || !Intl.Segmenter) return fallbackCount;
    const segmenter = new Intl.Segmenter("und", { granularity: "word" });
    const segmentedCount = Array.from(segmenter.segment(text)).filter(
      (segment) => segment.isWordLike
    ).length;
    return segmentedCount || fallbackCount;
  } catch {
    return fallbackCount;
  }
}
