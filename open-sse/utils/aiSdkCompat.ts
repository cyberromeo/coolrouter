/**
 * AI SDK compatibility helpers (T26).
 */

/**
 * Detects when a client explicitly prefers JSON (non-SSE) responses.
 */
export function clientWantsJsonResponse(acceptHeader: unknown): boolean {
  if (typeof acceptHeader !== "string") return false;
  const normalized = acceptHeader.toLowerCase();
  return normalized.includes("application/json") && !normalized.includes("text/event-stream");
}

/**
 * Detects when a client explicitly asks for a server-sent event stream.
 */
export function clientAcceptsEventStream(acceptHeader: unknown): boolean {
  return (
    typeof acceptHeader === "string" && acceptHeader.toLowerCase().includes("text/event-stream")
  );
}

/**
 * Client formats whose API specs define `stream` as optional and defaulting to `false`:
 * OpenAI Chat Completions, OpenAI Responses and Anthropic Messages.
 */
const NON_STREAMING_BY_DEFAULT_FORMATS = new Set(["openai", "openai-responses", "claude"]);

/**
 * Resolves stream behavior from request body + Accept header.
 * Priority: explicit `stream: true/false` in body wins.
 * Accept header only acts as fallback when stream is not explicitly set.
 * Fixes #656: clients sending both `stream: true` and `Accept: application/json`
 * should still get streaming responses — body intent takes precedence.
 *
 * When `stream` is omitted the default depends on the client format:
 * - OpenAI / OpenAI Responses / Anthropic (`sourceFormat` given): non-streaming, as their
 *   specs require, unless the Accept header explicitly includes `text/event-stream`.
 *   A wildcard or missing Accept (curl, fetch, Python requests) is therefore non-streaming.
 * - Any other format, or no `sourceFormat`: legacy behavior — stream unless the client
 *   explicitly prefers JSON. Those formats carry no `stream` field (Gemini-style clients
 *   pick the mode with the URL) or default to streaming (Ollama).
 */
export function resolveStreamFlag(
  bodyStream: unknown,
  acceptHeader: unknown,
  sourceFormat?: unknown
): boolean {
  // Explicit body value always wins
  if (bodyStream === true) return true;
  if (bodyStream === false) return false;
  // No explicit stream param — spec default for formats that define one
  if (typeof sourceFormat === "string" && NON_STREAMING_BY_DEFAULT_FORMATS.has(sourceFormat)) {
    return clientAcceptsEventStream(acceptHeader);
  }
  // Legacy fallback: Accept header heuristic
  return !clientWantsJsonResponse(acceptHeader);
}

/**
 * Resolves explicit stream aliases used by non-standard clients.
 * Returns:
 * - `true`  -> explicit streaming intent
 * - `false` -> explicit non-stream intent
 * - `undefined` -> no explicit alias present
 */
export function resolveExplicitStreamAlias(body: unknown): boolean | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;

  if (b.streaming === true) return true;
  if (b.streaming === false) return false;
  if (b.non_stream === true) return false;
  if (b.disable_stream === true) return false;
  if (b.disable_streaming === true) return false;

  return undefined;
}

/**
 * Backward-compatible helper used by tests/legacy call sites.
 */
export function hasExplicitNoStreamParam(body: unknown): boolean {
  return resolveExplicitStreamAlias(body) === false;
}

/**
 * Removes surrounding markdown code fences when Claude wraps JSON payloads.
 * Example: ```json\n{"ok":true}\n``` -> {"ok":true}
 */
export function stripMarkdownCodeFence(text: unknown): unknown {
  if (typeof text !== "string") return text;
  const codeBlockRegex = /^```(?:json|javascript|typescript|js|ts)?\s*\n?([\s\S]*?)\n?```\s*$/i;
  const match = text.trim().match(codeBlockRegex);
  return match ? match[1].trim() : text;
}
