import { ToolRegistry } from "./ToolRegistry";
import { clipboardTool } from "./clipboardTool";
import { createSnippetTool, createUpdateSnippetsTool, type SnippetActions } from "./snippetTool";
import { createUpdateDictionaryTool, type DictionaryActions } from "./dictionaryTool";

export { ToolRegistry } from "./ToolRegistry";
export type { ToolDefinition, ToolResult } from "./ToolRegistry";

interface ToolRegistrySettings {
  /** Live dictionary and snippet access; enables the vocabulary tools. */
  vocabulary?: DictionaryActions & SnippetActions;
}

export function createToolRegistry(settings: ToolRegistrySettings): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(clipboardTool);

  if (settings.vocabulary) {
    const snippets = settings.vocabulary.getSnippets();
    if (snippets.length > 0) registry.register(createSnippetTool(snippets));
    registry.register(createUpdateDictionaryTool(settings.vocabulary));
    registry.register(createUpdateSnippetsTool(settings.vocabulary));
  }

  return registry;
}
