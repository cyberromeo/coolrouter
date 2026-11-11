/**
 * Responses API request fields that survive the Responses → Chat Completions
 * translation (`openai-responses.ts` copies the request and deletes only the fields
 * it converts). Chat Completions has no such fields, so strict providers reject the
 * whole request with a 400 / 422 ("Extra inputs are not permitted").
 */

type JsonRecord = Record<string, unknown>;

const RESPONSES_ONLY_FIELDS = [
  "text",
  "truncation",
  "previous_response_id",
  "max_tool_calls",
  "client_metadata",
  "safety_identifier",
  "conversation",
  "prompt",
  "background",
];

/** Providers that reject unknown top-level fields; they also lose `prompt_cache_key`. */
const STRICT_CHAT_PROVIDERS = new Set(["mistral", "groq"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * For providers that reject unknown fields: turn Responses-only fields into their
 * Chat equivalents where one exists (`text.format` → `response_format`) and drop the
 * rest. Other providers keep receiving the request as before (they ignore the extra
 * fields, and some proxies forward `previous_response_id` on purpose).
 * Mutates and returns `body`.
 */
export function stripResponsesLeftoversForChat(body: JsonRecord, provider: string): JsonRecord {
  if (!isRecord(body) || !STRICT_CHAT_PROVIDERS.has(provider)) return body;
  const isOfficialOpenAI = provider === "openai";

  const text = isRecord(body.text) ? body.text : null;
  if (text) {
    const format = isRecord(text.format) ? text.format : null;
    if (format && body.response_format === undefined) {
      if (format.type === "json_schema") {
        const { type: _type, ...schemaFields } = format;
        body.response_format = { type: "json_schema", json_schema: schemaFields };
      } else if (format.type === "json_object") {
        body.response_format = { type: "json_object" };
      }
    }
    if (isOfficialOpenAI && typeof text.verbosity === "string" && body.verbosity === undefined) {
      body.verbosity = text.verbosity;
    }
  }

  for (const field of RESPONSES_ONLY_FIELDS) delete body[field];
  if (STRICT_CHAT_PROVIDERS.has(provider)) delete body.prompt_cache_key;
  return body;
}
