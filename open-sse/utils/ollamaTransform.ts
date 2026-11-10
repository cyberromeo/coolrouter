/**
 * Ollama client-format adapter for POST /v1/api/chat.
 *
 * The route converts the Ollama chat request to an OpenAI chat request, runs it through
 * the shared chat pipeline, and converts the OpenAI-format answer back with transformToOllama.
 */
import { getCorsOrigin } from "./cors.ts";
import {
  carryResponseHeaders,
  createSseDataTransform,
  extractErrorMessage,
  isEventStreamResponse,
  readJsonBody,
} from "./sseDataTransform.ts";

type JsonRecord = Record<string, unknown>;

type PendingToolCall = {
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
};

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseToolArguments(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toOllamaToolCalls(toolCalls: PendingToolCall[]) {
  return toolCalls.map((tc) => ({
    function: {
      name: tc.function.name,
      arguments: parseToolArguments(tc.function.arguments),
    },
  }));
}

function ollamaUsage(usageValue: unknown): JsonRecord {
  const usage = toRecord(usageValue);
  const promptTokens = toNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = toNumber(usage.completion_tokens ?? usage.output_tokens);
  return {
    ...(promptTokens !== undefined ? { prompt_eval_count: promptTokens } : {}),
    ...(completionTokens !== undefined ? { eval_count: completionTokens } : {}),
  };
}

function ollamaDoneReason(finishReason: unknown): string {
  return finishReason === "length" ? "length" : "stop";
}

// Ollama `options` that have a direct OpenAI chat equivalent.
const OLLAMA_OPTION_MAP: Record<string, string> = {
  temperature: "temperature",
  top_p: "top_p",
  num_predict: "max_tokens",
  stop: "stop",
  seed: "seed",
  presence_penalty: "presence_penalty",
  frequency_penalty: "frequency_penalty",
};

/**
 * Convert an Ollama /api/chat request to an OpenAI chat completions request.
 * - `stream` defaults to true (Ollama streams unless told otherwise);
 * - sampling `options` are mapped to their OpenAI names, `format` to `response_format`;
 * - `images` on a message become image_url content parts;
 * - Ollama-only fields (`options`, `format`, `keep_alive`, `think`) are not forwarded.
 */
export function ollamaToOpenAIChatRequest(ollamaBody: unknown): JsonRecord {
  const { options, format, keep_alive: _keepAlive, think: _think, ...rest } = toRecord(ollamaBody);
  const result: JsonRecord = { ...rest, stream: rest.stream !== false };

  const optionRecord = toRecord(options);
  for (const [ollamaName, openaiName] of Object.entries(OLLAMA_OPTION_MAP)) {
    const value = optionRecord[ollamaName];
    if (value !== undefined && value !== null && result[openaiName] === undefined) {
      result[openaiName] = value;
    }
  }

  if (format === "json") {
    result.response_format = { type: "json_object" };
  } else if (format && typeof format === "object") {
    result.response_format = {
      type: "json_schema",
      json_schema: { name: "response", schema: format },
    };
  }

  if (Array.isArray(rest.messages)) {
    result.messages = rest.messages.map((messageValue) => {
      const message = toRecord(messageValue);
      if (!Array.isArray(message.images) || message.images.length === 0) return messageValue;
      const { images, ...messageRest } = message;
      const text = typeof message.content === "string" ? message.content : "";
      return {
        ...messageRest,
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...(images as unknown[])
            .filter((image) => typeof image === "string" && image)
            .map((image) => ({
              type: "image_url",
              image_url: {
                url: String(image).startsWith("data:") ? image : `data:image/png;base64,${image}`,
              },
            })),
        ],
      };
    });
  }

  return result;
}

/**
 * Convert an OpenAI chat.completion object to a single Ollama chat response
 * (the `"stream": false` shape).
 */
export function openAIToOllamaResponse(openaiResponse: unknown, model: string): JsonRecord {
  const root = toRecord(openaiResponse);
  const choice = toRecord(Array.isArray(root.choices) ? root.choices[0] : null);
  const source = toRecord(choice.message);

  let content = "";
  if (typeof source.content === "string") {
    content = source.content;
  } else if (Array.isArray(source.content)) {
    content = source.content
      .map((part) => (typeof toRecord(part).text === "string" ? toRecord(part).text : ""))
      .join("");
  }

  const message: JsonRecord = { role: "assistant", content };
  if (typeof source.reasoning_content === "string" && source.reasoning_content) {
    message.thinking = source.reasoning_content;
  }
  if (Array.isArray(source.tool_calls) && source.tool_calls.length > 0) {
    message.tool_calls = toOllamaToolCalls(
      source.tool_calls.map((toolCallValue) => {
        const fn = toRecord(toRecord(toolCallValue).function);
        return {
          function: {
            name: typeof fn.name === "string" ? fn.name : "",
            arguments:
              typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
          },
        };
      })
    );
  }

  return {
    model,
    created_at: new Date().toISOString(),
    message,
    done: true,
    done_reason: ollamaDoneReason(choice.finish_reason),
    ...ollamaUsage(root.usage),
  };
}

/**
 * TransformStream: OpenAI chat.completion.chunk SSE → Ollama NDJSON lines.
 * Content lines carry `"done": false`; the stream ends with exactly one `"done": true` line
 * holding done_reason and token counts.
 */
export function createOpenAIToOllamaStream(model: string): TransformStream<Uint8Array, Uint8Array> {
  let pendingToolCalls: Record<number, PendingToolCall> = {};
  const completedToolCalls: PendingToolCall[] = [];
  let finishReason: unknown = null;
  let usage: unknown = null;

  const line = (payload: JsonRecord) =>
    JSON.stringify({ model, created_at: new Date().toISOString(), ...payload }) + "\n";

  return createSseDataTransform({
    onData(parsed) {
      if (parsed.error) {
        return JSON.stringify({ error: extractErrorMessage(parsed, "Upstream error") }) + "\n";
      }

      if (parsed.usage && typeof parsed.usage === "object") usage = parsed.usage;

      const choice = toRecord(Array.isArray(parsed.choices) ? parsed.choices[0] : null);
      const delta = toRecord(choice.delta);
      if (choice.finish_reason) finishReason = choice.finish_reason;

      for (const toolCallValue of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const tc = toRecord(toolCallValue);
        const fn = toRecord(tc.function);
        const idx = toNumber(tc.index) ?? 0;
        const id = typeof tc.id === "string" && tc.id ? tc.id : undefined;

        // T37: Prevent merging tool_calls on same index if ID changes
        if (pendingToolCalls[idx] && id && pendingToolCalls[idx].id !== id) {
          completedToolCalls.push(pendingToolCalls[idx]);
          delete pendingToolCalls[idx];
        }

        if (!pendingToolCalls[idx]) {
          pendingToolCalls[idx] = { id, function: { name: "", arguments: "" } };
        }
        if (typeof fn.name === "string") pendingToolCalls[idx].function.name += fn.name;
        if (typeof fn.arguments === "string") {
          pendingToolCalls[idx].function.arguments += fn.arguments;
        }
      }

      let output = "";
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        output += line({
          message: { role: "assistant", content: "", thinking: delta.reasoning_content },
          done: false,
        });
      }
      if (typeof delta.content === "string" && delta.content) {
        output += line({ message: { role: "assistant", content: delta.content }, done: false });
      }
      return output;
    },
    onDone() {
      let output = "";
      const toolCalls = [...completedToolCalls, ...Object.values(pendingToolCalls)];
      pendingToolCalls = {};
      if (toolCalls.length > 0) {
        output += line({
          message: { role: "assistant", content: "", tool_calls: toOllamaToolCalls(toolCalls) },
          done: false,
        });
      }
      output += line({
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: ollamaDoneReason(finishReason),
        ...ollamaUsage(usage),
      });
      return output;
    },
  });
}

/**
 * Convert the pipeline's OpenAI-format Response into the Ollama chat wire format.
 * - errors → `{ "error": "<message>" }` with the same HTTP status;
 * - SSE → NDJSON lines (default, streaming);
 * - JSON (`"stream": false`) → one JSON object.
 */
export async function transformToOllama(response: Response, model: string): Promise<Response> {
  if (!response.ok) {
    const payload = await readJsonBody(response);
    const message = extractErrorMessage(payload, response.statusText || "Request failed");
    return new Response(JSON.stringify({ error: message }), {
      status: response.status,
      headers: carryResponseHeaders(response, "application/json"),
    });
  }

  if (isEventStreamResponse(response) && response.body) {
    const headers = carryResponseHeaders(response, "application/x-ndjson");
    headers.set("Access-Control-Allow-Origin", getCorsOrigin());
    return new Response(response.body.pipeThrough(createOpenAIToOllamaStream(model)), {
      headers,
    });
  }

  const payload = await readJsonBody(response);
  const headers = carryResponseHeaders(response, "application/json");
  headers.set("Access-Control-Allow-Origin", getCorsOrigin());
  return new Response(JSON.stringify(openAIToOllamaResponse(payload, model)), { headers });
}
