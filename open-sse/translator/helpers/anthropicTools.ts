/**
 * Helpers for Anthropic-defined tools in Claude (Messages API) requests.
 *
 * Anthropic-defined tools carry a versioned `type` such as `web_search_20250305`,
 * `web_fetch_20250910`, `code_execution_20250825` or `advisor_20260301`, and no
 * `input_schema`. Anthropic either runs them itself (server tools) or the client
 * implements a schema Anthropic supplies. A non-Claude model can do neither: turned
 * into an empty-schema function, the model "calls" a tool nobody executes, and the
 * client (Claude Code) waits for a server result that never comes.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a tool that only Anthropic's API can run or describe. */
export function isAnthropicDefinedTool(tool: unknown): boolean {
  if (!isRecord(tool)) return false;
  const type = typeof tool.type === "string" ? tool.type : "";
  if (!type || type === "custom" || type === "function") return false;
  return tool.input_schema === undefined;
}

/** Tools a non-Claude model can call: everything except Anthropic-defined tools. */
export function filterPortableClaudeTools(tools: unknown): JsonRecord[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter(
    (tool): tool is JsonRecord => isRecord(tool) && !isAnthropicDefinedTool(tool)
  );
}
