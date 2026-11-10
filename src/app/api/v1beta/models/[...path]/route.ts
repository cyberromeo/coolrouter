import { CORS_ORIGIN } from "@/shared/utils/cors";
import { buildClientRawRequest, handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@coolrouter/open-sse/translator/index.ts";
import {
  estimateGeminiTokens,
  extractGeminiApiKey,
  geminiErrorResponse,
  geminiToOpenAIChatRequest,
  parseGeminiModelPath,
  transformToGemini,
} from "@coolrouter/open-sse/utils/geminiTransform.ts";
import { v1betaGeminiGenerateSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized for /v1beta/models");
  }
}

function corsHeaders() {
  return new Headers({ "Access-Control-Allow-Origin": CORS_ORIGIN });
}

/**
 * Handle CORS preflight
 */
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
 * Request handed to the shared chat handler: the converted OpenAI body, plus the client's
 * API key moved to where the handler looks for it. Gemini clients send the key as
 * `x-goog-api-key` or `?key=`; the handler reads `Authorization: Bearer`. The key is taken
 * off the URL and out of the Gemini header so it is not written to request logs.
 */
function buildForwardRequest(request: Request, body: unknown, stream: boolean) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const geminiKey = extractGeminiApiKey(request);
  if (geminiKey && !headers.get("authorization")) {
    headers.set("authorization", `Bearer ${geminiKey}`);
  }
  headers.delete("x-goog-api-key");
  headers.delete("content-length");
  url.searchParams.delete("key");
  // The URL already decided the mode; keep the Accept header from overriding it.
  headers.set("accept", stream ? "text/event-stream" : "application/json");

  return new Request(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * POST /v1beta/models/{model}:generateContent
 * POST /v1beta/models/{model}:streamGenerateContent[?alt=sse]
 * POST /v1beta/models/{model}:countTokens
 *
 * Gemini (Google Generative Language API) compatible endpoint. The request is converted to
 * the internal OpenAI chat format, handled via handleChat, and the answer is converted back
 * to Gemini's wire format — a GenerateContentResponse object, or a stream of them.
 */
export async function POST(request, { params }) {
  await ensureInitialized();

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return geminiErrorResponse(400, "Invalid JSON payload received.", corsHeaders());
  }

  try {
    const { path } = await params;
    // path = ["provider", "model:generateContent"] or ["model:generateContent"]
    const { model, action } = parseGeminiModelPath(path);

    if (!model) {
      return geminiErrorResponse(400, "Model name is required.", corsHeaders());
    }

    if (action === "countTokens") {
      return Response.json(
        { totalTokens: estimateGeminiTokens(rawBody) },
        { headers: corsHeaders() }
      );
    }

    if (action !== "generateContent" && action !== "streamGenerateContent") {
      return geminiErrorResponse(
        404,
        `models/${model} does not support the method "${action}". ` +
          "Supported methods: generateContent, streamGenerateContent, countTokens.",
        corsHeaders()
      );
    }

    const validation = validateBody(v1betaGeminiGenerateSchema, rawBody);
    if (isValidationFailure(validation)) {
      const details = validation.error.details
        .map((detail) => (detail.field ? `${detail.field}: ${detail.message}` : detail.message))
        .join("; ");
      return geminiErrorResponse(
        400,
        details ? `${validation.error.message}: ${details}` : validation.error.message,
        corsHeaders()
      );
    }
    const body = validation.data;

    // The URL decides the mode: :streamGenerateContent streams, :generateContent does not.
    const stream = action === "streamGenerateContent";
    const sse = new URL(request.url).searchParams.get("alt") === "sse";

    // Convert Gemini format to OpenAI/internal format
    const convertedBody = geminiToOpenAIChatRequest(body, model, stream);
    const forwardRequest = buildForwardRequest(request, convertedBody, stream);

    const response = await handleChat(
      forwardRequest,
      buildClientRawRequest(forwardRequest, rawBody)
    );
    return await transformToGemini(response, { model, stream, sse });
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return geminiErrorResponse(500, error?.message || "Internal error", corsHeaders());
  }
}
