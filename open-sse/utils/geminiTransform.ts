/**
 * Gemini client-format adapter for POST /v1beta/models/{model}:generateContent and
 * :streamGenerateContent (Google Generative Language API).
 *
 * The route converts the Gemini request to an OpenAI chat request, runs it through the
 * shared chat pipeline, and converts the OpenAI-format answer back with the helpers here.
 */
import {
  carryResponseHeaders,
  createSseDataTransform,
  extractErrorMessage,
  isEventStreamResponse,
  readJsonBody,
} from "./sseDataTransform.ts";

type JsonRecord = Record<string, unknown>;

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ──────────────────────────────── Request ────────────────────────────────

/**
 * Splits the catch-all path of /v1beta/models/... into the model id and the action.
 * `["mock", "mock-small:generateContent"]` → `{ model: "mock/mock-small", action: "generateContent" }`.
 * The action is whatever follows the last colon, so model ids may contain slashes and colons.
 */
export function parseGeminiModelPath(path: unknown): { model: string; action: string } {
  const segments = (Array.isArray(path) ? path : [path]).map((segment) => {
    const raw = String(segment ?? "");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  });
  let full = segments.join("/");
  if (full.startsWith("models/")) full = full.slice("models/".length);
  const colon = full.lastIndexOf(":");
  if (colon === -1) return { model: full, action: "" };
  return { model: full.slice(0, colon), action: full.slice(colon + 1) };
}

/**
 * The API key as Gemini clients send it: the `x-goog-api-key` header or the `?key=` query
 * parameter. Returns null when neither is present.
 */
export function extractGeminiApiKey(request: Request): string | null {
  const headerKey = request.headers.get("x-goog-api-key");
  if (headerKey && headerKey.trim()) return headerKey.trim();
  try {
    const queryKey = new URL(request.url).searchParams.get("key");
    if (queryKey && queryKey.trim()) return queryKey.trim();
  } catch {
    // malformed URL — no key
  }
  return null;
}

function geminiPartsText(value: unknown): string {
  if (typeof value === "string") return value;
  const parts = toRecord(value).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof toRecord(part).text === "string" ? (toRecord(part).text as string) : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * Convert a Gemini generateContent request to an OpenAI chat completions request.
 *
 * Function calling: Gemini pairs a functionResponse with its functionCall by name (ids are
 * optional), OpenAI by id — ids are taken from the request when present and otherwise
 * assigned in order of appearance.
 */
export function geminiToOpenAIChatRequest(
  geminiBody: unknown,
  model: string,
  stream: boolean
): JsonRecord {
  const body = toRecord(geminiBody);
  const messages: JsonRecord[] = [];

  // REST clients send snake_case `system_instruction`, the SDKs camelCase.
  const systemText = geminiPartsText(body.systemInstruction ?? body.system_instruction);
  if (systemText) messages.push({ role: "system", content: systemText });

  const pendingCallIds = new Map<string, string[]>();
  let callSeq = 0;

  for (const contentValue of Array.isArray(body.contents) ? body.contents : []) {
    const content = toRecord(contentValue);
    const role = content.role === "model" ? "assistant" : "user";
    const contentParts: JsonRecord[] = [];
    const toolCalls: JsonRecord[] = [];
    const toolResults: JsonRecord[] = [];

    for (const partValue of Array.isArray(content.parts) ? content.parts : []) {
      const part = toRecord(partValue);
      if (part.thought === true) continue; // model reasoning is not replayed upstream

      if (typeof part.text === "string") {
        contentParts.push({ type: "text", text: part.text });
      }

      const inlineData = toRecord(part.inlineData ?? part.inline_data);
      if (typeof inlineData.data === "string" && inlineData.data) {
        const mimeType = String(inlineData.mimeType ?? inlineData.mime_type ?? "image/png");
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${inlineData.data}` },
        });
      }

      const functionCall = toRecord(part.functionCall ?? part.function_call);
      if (typeof functionCall.name === "string" && functionCall.name) {
        const name = functionCall.name;
        const id =
          typeof functionCall.id === "string" && functionCall.id
            ? functionCall.id
            : `call_${++callSeq}_${name}`;
        pendingCallIds.set(name, [...(pendingCallIds.get(name) || []), id]);
        toolCalls.push({
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(functionCall.args ?? {}) },
        });
      }

      const functionResponse = toRecord(part.functionResponse ?? part.function_response);
      if (typeof functionResponse.name === "string" && functionResponse.name) {
        const name = functionResponse.name;
        const queue = pendingCallIds.get(name) || [];
        let id = typeof functionResponse.id === "string" ? functionResponse.id : "";
        if (id) {
          const index = queue.indexOf(id);
          if (index !== -1) queue.splice(index, 1);
        } else {
          id = queue.shift() || `call_${name}`;
        }
        const result = functionResponse.response;
        toolResults.push({
          role: "tool",
          tool_call_id: id,
          content: typeof result === "string" ? result : JSON.stringify(result ?? {}),
        });
      }
    }

    messages.push(...toolResults);

    if (role === "assistant") {
      if (contentParts.length === 0 && toolCalls.length === 0) continue;
      const text = contentParts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      messages.push({
        role: "assistant",
        content: text || (toolCalls.length > 0 ? null : ""),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (contentParts.length > 0) {
      const textOnly = contentParts.every((part) => part.type === "text");
      messages.push({
        role: "user",
        content: textOnly ? contentParts.map((part) => part.text).join("\n") : contentParts,
      });
    }
  }

  // `stream` is only set for :streamGenerateContent. :generateContent leaves it out, like an
  // OpenAI SDK call without `stream`: non-streaming, and not opted into the semantic cache
  // (which only serves requests that say `stream: false` themselves).
  const result: JsonRecord = { model, messages };
  if (stream) result.stream = true;

  const config = toRecord(body.generationConfig ?? body.generation_config);
  const maxOutputTokens = toNumber(config.maxOutputTokens ?? config.max_output_tokens);
  if (maxOutputTokens !== undefined) result.max_tokens = maxOutputTokens;
  if (toNumber(config.temperature) !== undefined) result.temperature = config.temperature;
  const topP = toNumber(config.topP ?? config.top_p);
  if (topP !== undefined) result.top_p = topP;
  const stopSequences = config.stopSequences ?? config.stop_sequences;
  if (Array.isArray(stopSequences) && stopSequences.length > 0) result.stop = stopSequences;
  if ((config.responseMimeType ?? config.response_mime_type) === "application/json") {
    result.response_format = { type: "json_object" };
  }

  const tools: JsonRecord[] = [];
  for (const toolValue of Array.isArray(body.tools) ? body.tools : []) {
    const tool = toRecord(toolValue);
    const declarations = tool.functionDeclarations ?? tool.function_declarations;
    for (const declarationValue of Array.isArray(declarations) ? declarations : []) {
      const declaration = toRecord(declarationValue);
      if (typeof declaration.name !== "string" || !declaration.name) continue;
      tools.push({
        type: "function",
        function: {
          name: declaration.name,
          description: typeof declaration.description === "string" ? declaration.description : "",
          parameters: declaration.parameters ??
            declaration.parametersJsonSchema ?? { type: "object", properties: {} },
        },
      });
    }
  }
  if (tools.length > 0) {
    result.tools = tools;
    const callingConfig = toRecord(
      toRecord(body.toolConfig ?? body.tool_config).functionCallingConfig ??
        toRecord(body.toolConfig ?? body.tool_config).function_calling_config
    );
    const mode = typeof callingConfig.mode === "string" ? callingConfig.mode.toUpperCase() : "";
    if (mode === "ANY") result.tool_choice = "required";
    else if (mode === "NONE") result.tool_choice = "none";
  }

  return result;
}

/**
 * Rough token estimate for :countTokens (about four characters per token, the same
 * heuristic as /v1/messages/count_tokens).
 */
export function estimateGeminiTokens(geminiBody: unknown): number {
  const body = toRecord(geminiBody);
  // countTokens accepts either `contents` or a whole `generateContentRequest`.
  const request = toRecord(body.generateContentRequest ?? body.generate_content_request);
  const source = Object.keys(request).length > 0 ? request : body;
  let chars = geminiPartsText(source.systemInstruction ?? source.system_instruction).length;
  for (const content of Array.isArray(source.contents) ? source.contents : []) {
    chars += geminiPartsText(content).length;
  }
  return Math.ceil(chars / 4);
}

// ──────────────────────────────── Response ────────────────────────────────

const FINISH_REASONS: Record<string, string> = {
  stop: "STOP",
  length: "MAX_TOKENS",
  content_filter: "SAFETY",
  tool_calls: "STOP",
  function_call: "STOP",
};

export function toGeminiFinishReason(finishReason: unknown): string {
  return (typeof finishReason === "string" && FINISH_REASONS[finishReason]) || "STOP";
}

export function toGeminiUsageMetadata(usageValue: unknown): JsonRecord | null {
  const usage = toRecord(usageValue);
  const prompt = toNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completion = toNumber(usage.completion_tokens ?? usage.output_tokens);
  if (prompt === undefined && completion === undefined) return null;

  const promptTokens = prompt ?? 0;
  const completionTokens = completion ?? 0;
  // OpenAI counts reasoning inside completion_tokens; Gemini reports it separately.
  const thoughts = Math.min(
    toNumber(toRecord(usage.completion_tokens_details).reasoning_tokens) ?? 0,
    completionTokens
  );
  const cached = toNumber(toRecord(usage.prompt_tokens_details).cached_tokens) ?? 0;

  return {
    promptTokenCount: promptTokens,
    candidatesTokenCount: completionTokens - thoughts,
    totalTokenCount: toNumber(usage.total_tokens) ?? promptTokens + completionTokens,
    ...(thoughts > 0 ? { thoughtsTokenCount: thoughts } : {}),
    ...(cached > 0 ? { cachedContentTokenCount: cached } : {}),
  };
}

function parseToolArguments(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toFunctionCallPart(toolCallValue: unknown): JsonRecord | null {
  const toolCall = toRecord(toolCallValue);
  const fn = toRecord(toolCall.function);
  if (typeof fn.name !== "string" || !fn.name) return null;
  return {
    functionCall: {
      ...(typeof toolCall.id === "string" && toolCall.id ? { id: toolCall.id } : {}),
      name: fn.name,
      args: parseToolArguments(fn.arguments),
    },
  };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof toRecord(part).text === "string" ? (toRecord(part).text as string) : ""))
    .join("");
}

/**
 * Convert an OpenAI chat.completion object to a Gemini GenerateContentResponse.
 */
export function openAIToGeminiResponse(openaiResponse: unknown, fallbackModel = ""): JsonRecord {
  const root = toRecord(openaiResponse);
  const choices = Array.isArray(root.choices) && root.choices.length > 0 ? root.choices : [{}];

  const candidates = choices.map((choiceValue, position) => {
    const choice = toRecord(choiceValue);
    const message = toRecord(choice.message);
    const parts: JsonRecord[] = [];

    if (typeof message.reasoning_content === "string" && message.reasoning_content) {
      parts.push({ text: message.reasoning_content, thought: true });
    }
    const text = messageText(message.content);
    if (text) parts.push({ text });
    for (const toolCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const part = toFunctionCallPart(toolCall);
      if (part) parts.push(part);
    }
    if (parts.length === 0) parts.push({ text: "" });

    return {
      content: { role: "model", parts },
      finishReason: toGeminiFinishReason(choice.finish_reason),
      index: toNumber(choice.index) ?? position,
    };
  });

  const usageMetadata = toGeminiUsageMetadata(root.usage);
  return {
    candidates,
    ...(usageMetadata ? { usageMetadata } : {}),
    modelVersion: typeof root.model === "string" && root.model ? root.model : fallbackModel,
    ...(typeof root.id === "string" && root.id ? { responseId: root.id } : {}),
  };
}

// ──────────────────────────────── Errors ────────────────────────────────

const GEMINI_ERROR_STATUS: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "ABORTED",
  429: "RESOURCE_EXHAUSTED",
  499: "CANCELLED",
  500: "INTERNAL",
  501: "UNIMPLEMENTED",
  502: "UNAVAILABLE",
  503: "UNAVAILABLE",
  504: "DEADLINE_EXCEEDED",
};

/**
 * Error body in Google's shape: `{ error: { code, message, status } }`.
 */
export function buildGeminiErrorBody(statusCode: number, message: string): JsonRecord {
  const status =
    GEMINI_ERROR_STATUS[statusCode] || (statusCode >= 500 ? "INTERNAL" : "INVALID_ARGUMENT");
  return { error: { code: statusCode, message: message || "Request failed", status } };
}

export function geminiErrorResponse(
  statusCode: number,
  message: string,
  headers?: Headers
): Response {
  const responseHeaders = headers || new Headers();
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(buildGeminiErrorBody(statusCode, message)), {
    status: statusCode,
    headers: responseHeaders,
  });
}

// ──────────────────────────────── Streaming ────────────────────────────────

/**
 * TransformStream: OpenAI chat.completion.chunk SSE → Gemini streamGenerateContent output.
 * `sse: true` (`?alt=sse`) emits `data: <GenerateContentResponse>` events; otherwise the
 * chunks are emitted as one JSON array, as Google does without `alt=sse`.
 * Text is forwarded as it arrives; the last chunk carries finishReason, usageMetadata and
 * any function calls (their arguments only become valid JSON once complete).
 */
export function createOpenAIToGeminiStream(
  fallbackModel: string,
  { sse }: { sse: boolean }
): TransformStream<Uint8Array, Uint8Array> {
  let modelVersion = fallbackModel;
  let responseId = "";
  let finishReason: unknown = null;
  let usage: unknown = null;
  let emitted = 0;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  const frame = (payload: JsonRecord): string => {
    const json = JSON.stringify(payload);
    const text = sse ? `data: ${json}\n\n` : `${emitted === 0 ? "[" : ",\n"}${json}`;
    emitted += 1;
    return text;
  };

  const chunkPayload = (parts: JsonRecord[], extra: JsonRecord = {}): JsonRecord => ({
    candidates: [{ content: { role: "model", parts }, index: 0, ...extra }],
    ...(extra.finishReason && toGeminiUsageMetadata(usage)
      ? { usageMetadata: toGeminiUsageMetadata(usage) }
      : {}),
    modelVersion,
    ...(responseId ? { responseId } : {}),
  });

  return createSseDataTransform({
    onData(parsed) {
      if (parsed.error) {
        const error = toRecord(parsed.error);
        const code = toNumber(error.code) ?? 500;
        return frame(buildGeminiErrorBody(code, extractErrorMessage(parsed, "Upstream error")));
      }

      if (typeof parsed.model === "string" && parsed.model) modelVersion = parsed.model;
      if (typeof parsed.id === "string" && parsed.id) responseId = parsed.id;
      if (parsed.usage && typeof parsed.usage === "object") usage = parsed.usage;

      const choice = toRecord(Array.isArray(parsed.choices) ? parsed.choices[0] : null);
      const delta = toRecord(choice.delta);
      if (choice.finish_reason) finishReason = choice.finish_reason;

      for (const toolCallValue of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const toolCall = toRecord(toolCallValue);
        const fn = toRecord(toolCall.function);
        const index = toNumber(toolCall.index) ?? toolCalls.size;
        const entry = toolCalls.get(index) || { id: "", name: "", args: "" };
        if (typeof toolCall.id === "string" && toolCall.id) entry.id = toolCall.id;
        if (typeof fn.name === "string") entry.name += fn.name;
        if (typeof fn.arguments === "string") entry.args += fn.arguments;
        toolCalls.set(index, entry);
      }

      const parts: JsonRecord[] = [];
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        parts.push({ text: delta.reasoning_content, thought: true });
      }
      if (typeof delta.content === "string" && delta.content) {
        parts.push({ text: delta.content });
      }
      return parts.length > 0 ? frame(chunkPayload(parts)) : null;
    },
    onDone() {
      const parts: JsonRecord[] = [];
      for (const [, entry] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        const part = toFunctionCallPart({
          id: entry.id,
          function: { name: entry.name, arguments: entry.args },
        });
        if (part) parts.push(part);
      }
      if (parts.length === 0) parts.push({ text: "" });
      const last = frame(chunkPayload(parts, { finishReason: toGeminiFinishReason(finishReason) }));
      return sse ? last : `${last}]`;
    },
  });
}

/**
 * Convert the pipeline's OpenAI-format Response into the Gemini wire format.
 * - errors → Google error shape, same HTTP status;
 * - `stream: false` (:generateContent) → one GenerateContentResponse JSON object;
 * - `stream: true` (:streamGenerateContent) → SSE events (`sse`) or a JSON array.
 */
export async function transformToGemini(
  response: Response,
  { model, stream, sse }: { model: string; stream: boolean; sse: boolean }
): Promise<Response> {
  if (!response.ok) {
    const payload = await readJsonBody(response);
    return geminiErrorResponse(
      response.status,
      extractErrorMessage(payload, response.statusText || "Request failed"),
      carryResponseHeaders(response, "application/json")
    );
  }

  if (stream && isEventStreamResponse(response) && response.body) {
    const headers = carryResponseHeaders(response, sse ? "text/event-stream" : "application/json");
    if (sse) headers.set("Cache-Control", "no-cache");
    return new Response(response.body.pipeThrough(createOpenAIToGeminiStream(model, { sse })), {
      status: 200,
      headers,
    });
  }

  // JSON answer. For :streamGenerateContent this only happens when the pipeline replies
  // without streaming (e.g. an idempotent replay); it is framed as a one-chunk stream.
  const payload = await readJsonBody(response);
  const gemini = openAIToGeminiResponse(payload, model);
  const json = JSON.stringify(gemini);
  if (stream && sse) {
    return new Response(`data: ${json}\n\n`, {
      status: 200,
      headers: carryResponseHeaders(response, "text/event-stream"),
    });
  }
  return new Response(stream ? `[${json}]` : json, {
    status: 200,
    headers: carryResponseHeaders(response, "application/json"),
  });
}
