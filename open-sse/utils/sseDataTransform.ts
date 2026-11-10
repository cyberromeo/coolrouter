/**
 * Scaffolding for the client-format adapters (Gemini, Ollama, legacy completions).
 *
 * The chat pipeline answers those routes with an OpenAI-style SSE byte stream
 * (`data: {json}` events terminated by `data: [DONE]`). This builds a TransformStream that
 * parses it and lets the adapter emit its own wire format:
 * - `onData(parsed)` is called for every JSON event and returns the text to emit (or nothing);
 * - `onDone()` is called exactly once, at `[DONE]` or at end of stream, whichever comes first.
 */
export function createSseDataTransform({
  onData,
  onDone,
}: {
  onData: (parsed: Record<string, unknown>) => string | null | undefined | void;
  onDone?: () => string | null | undefined | void;
}): TransformStream<Uint8Array, Uint8Array> {
  // One decoder for the whole stream: a multi-byte character may be split across chunks.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let finished = false;

  const emit = (
    controller: TransformStreamDefaultController<Uint8Array>,
    text: string | null | undefined | void
  ) => {
    if (text) controller.enqueue(encoder.encode(text));
  };

  const finish = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (finished) return;
    finished = true;
    emit(controller, onDone?.());
  };

  const handleLine = (
    rawLine: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ) => {
    const line = rawLine.replace(/\r$/, "");
    if (finished || !line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      finish(controller);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // not JSON — nothing an adapter can translate
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      emit(controller, onData(parsed as Record<string, unknown>));
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) handleLine(line, controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) handleLine(buffer, controller);
      finish(controller);
    },
  });
}

/**
 * Message of an error response produced by the pipeline (`{ error: { message } }`,
 * `{ error: "..." }` or `{ message }`), with a fallback for anything else.
 */
export function extractErrorMessage(payload: unknown, fallback = "Request failed"): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string" && error) return error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message) return message;
    }
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return fallback;
}

/**
 * Reads a pipeline response body as JSON; returns null when it is not JSON.
 */
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Headers worth carrying from the pipeline response onto the adapted one: CORS, retry
 * hints and the router's own `X-CoolRouter-*` diagnostics. Content-Type and length are
 * the adapter's to set.
 */
export function carryResponseHeaders(response: Response, contentType: string): Headers {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "retry-after" ||
      lower.startsWith("x-coolrouter-") ||
      lower.startsWith("access-control-")
    ) {
      headers.set(key, value);
    }
  });
  headers.set("Content-Type", contentType);
  return headers;
}

export function isEventStreamResponse(response: Response): boolean {
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream");
}
