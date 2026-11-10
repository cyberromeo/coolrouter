import { CORS_ORIGIN } from "@/shared/utils/cors";
import { handleChat } from "@/sse/handlers/chat";
import { withAnthropicApiKeyAsBearer } from "@/sse/services/auth";
import { initTranslators } from "@coolrouter/open-sse/translator/index.ts";
import { toClaudeErrorResponse } from "@coolrouter/open-sse/utils/error.ts";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized for /v1/messages");
  }
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
 * POST /v1/messages - Claude format (auto convert via handleChat)
 *
 * Errors are returned in the Anthropic shape:
 * `{ "type": "error", "error": { "type": "...", "message": "..." } }`
 */
export async function POST(request) {
  await ensureInitialized();
  const response = await handleChat(await withAnthropicApiKeyAsBearer(request));
  return await toClaudeErrorResponse(response);
}
