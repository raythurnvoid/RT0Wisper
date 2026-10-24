// Shared guard for reasoning/cleanup output (#1616): a whitespace-only reply counts
// as empty and must never replace existing text. Used by the agent/cleanup call
// sites in audioManager and the history-retry path in ControlPanel.
export function hasTextContent(value) {
  return typeof value === "string" && value.trim().length > 0;
}
