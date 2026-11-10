import { z } from "zod";
import { CORS_ORIGIN } from "@/shared/utils/cors";
import { buildClientRawRequest, handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@coolrouter/open-sse/translator/index.ts";
import {
  ollamaToOpenAIChatRequest,
  transformToOllama,
} from "@coolrouter/open-sse/utils/ollamaTransform.ts";

// Only the shape this route relies on; everything else is passed through to the converter.
const ollamaChatBodySchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(z.unknown()).min(1, "messages must contain at least one message"),
  })
  .catchall(z.unknown());

function ollamaError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": CORS_ORIGIN },
  });
}

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * POST /v1/api/chat - Ollama chat format.
 * Streams NDJSON lines by default; `"stream": false` returns one JSON object.
 */
export async function POST(request) {
  await ensureInitialized();

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return ollamaError("Invalid JSON body", 400);
  }

  const parsed = ollamaChatBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return ollamaError(issue?.message || "Invalid request body", 400);
  }

  const modelName = rawBody.model || "llama3.2";

  // Ollama streams unless the client opts out, while the OpenAI pipeline treats an omitted
  // `stream` as non-streaming — so the converted body always states it.
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const forwardRequest = new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify(ollamaToOpenAIChatRequest(rawBody)),
  });

  const response = await handleChat(forwardRequest, buildClientRawRequest(request, rawBody));
  return transformToOllama(response, modelName);
}
