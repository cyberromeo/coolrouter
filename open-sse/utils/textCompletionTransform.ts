/**
 * Legacy OpenAI Completions adapter for POST /v1/completions.
 *
 * A legacy request (`prompt`) is converted to a chat request, handled by the shared chat
 * pipeline, and the chat-format answer is converted back to the `text_completion` shape.
 */
import {
  carryResponseHeaders,
  createSseDataTransform,
  isEventStreamResponse,
  readJsonBody,
} from "./sseDataTransform.ts";

type JsonRecord = Record<string, unknown>;

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

/**
 * Convert a legacy completions request (`{ prompt, model }`) to a chat request
 * (`{ messages, model }`). Parameters that only exist on the legacy endpoint are dropped,
 * as chat upstreams reject them.
 */
export function textCompletionToChatRequest(legacyBody: unknown): JsonRecord {
  const { prompt, echo: _echo, suffix: _suffix, best_of: _bestOf, ...rest } = toRecord(legacyBody);
  // Legacy `logprobs` is a number; the chat parameter of the same name is a boolean.
  if (typeof rest.logprobs === "number") delete rest.logprobs;
  const text = Array.isArray(prompt) ? prompt.join("\n") : String(prompt);
  return { ...rest, messages: [{ role: "user", content: text }] };
}

function toCompletionId(id: unknown): string {
  if (typeof id !== "string" || !id) return `cmpl-${Date.now()}`;
  return id.startsWith("chatcmpl-") ? `cmpl-${id.slice("chatcmpl-".length)}` : id;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof toRecord(part).text === "string" ? toRecord(part).text : ""))
    .join("");
}

/**
 * Convert a chat.completion object to a legacy text_completion object. Payloads that are
 * not chat completions are returned unchanged.
 */
export function chatToTextCompletionResponse(chatResponse: unknown): unknown {
  const root = toRecord(chatResponse);
  if (!Array.isArray(root.choices)) return chatResponse;

  return {
    id: toCompletionId(root.id),
    object: "text_completion",
    created: typeof root.created === "number" ? root.created : Math.floor(Date.now() / 1000),
    model: root.model,
    choices: root.choices.map((choiceValue, position) => {
      const choice = toRecord(choiceValue);
      return {
        text: messageText(toRecord(choice.message).content),
        index: typeof choice.index === "number" ? choice.index : position,
        logprobs: null,
        finish_reason: choice.finish_reason ?? null,
      };
    }),
    ...(root.usage !== undefined ? { usage: root.usage } : {}),
    ...(root.system_fingerprint ? { system_fingerprint: root.system_fingerprint } : {}),
  };
}

/**
 * TransformStream: chat.completion.chunk SSE → legacy text_completion SSE chunks,
 * terminated by `data: [DONE]`.
 */
export function createChatToTextCompletionStream(): TransformStream<Uint8Array, Uint8Array> {
  return createSseDataTransform({
    onData(parsed) {
      if (parsed.error || !Array.isArray(parsed.choices)) {
        return `data: ${JSON.stringify(parsed)}\n\n`;
      }

      const choices = parsed.choices
        .map((choiceValue, position) => {
          const choice = toRecord(choiceValue);
          const text = toRecord(choice.delta).content;
          return {
            text: typeof text === "string" ? text : "",
            index: typeof choice.index === "number" ? choice.index : position,
            logprobs: null,
            finish_reason: choice.finish_reason ?? null,
          };
        })
        // Role-only and other empty deltas have no legacy counterpart.
        .filter((choice) => choice.text || choice.finish_reason);

      if (choices.length === 0 && parsed.usage === undefined) return null;

      return `data: ${JSON.stringify({
        id: toCompletionId(parsed.id),
        object: "text_completion",
        created: parsed.created,
        model: parsed.model,
        choices,
        ...(parsed.usage !== undefined ? { usage: parsed.usage } : {}),
      })}\n\n`;
    },
    onDone() {
      return "data: [DONE]\n\n";
    },
  });
}

/**
 * Convert the pipeline's chat-format Response into the legacy completions wire format.
 * Error responses already use the OpenAI error shape and pass through untouched.
 */
export async function transformToTextCompletion(response: Response): Promise<Response> {
  if (!response.ok) return response;

  if (isEventStreamResponse(response) && response.body) {
    const headers = carryResponseHeaders(response, "text/event-stream");
    headers.set("Cache-Control", "no-cache");
    return new Response(response.body.pipeThrough(createChatToTextCompletionStream()), {
      headers,
    });
  }

  const payload = await readJsonBody(response);
  return new Response(JSON.stringify(chatToTextCompletionResponse(payload)), {
    headers: carryResponseHeaders(response, "application/json"),
  });
}
