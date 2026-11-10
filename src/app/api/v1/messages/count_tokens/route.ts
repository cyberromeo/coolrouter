import { CORS_HEADERS } from "@/shared/utils/cors";
import { v1CountTokensSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { buildClaudeErrorBody } from "@coolrouter/open-sse/utils/error.ts";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /v1/messages/count_tokens - Mock token count response
 * (errors use the Anthropic shape, like /v1/messages)
 */
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify(buildClaudeErrorBody(400, "Invalid JSON body")), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const validation = validateBody(v1CountTokensSchema, rawBody);
  if (isValidationFailure(validation)) {
    const details = validation.error.details
      .map((detail) => (detail.field ? `${detail.field}: ${detail.message}` : detail.message))
      .join("; ");
    const message = details ? `${validation.error.message}: ${details}` : validation.error.message;
    return new Response(JSON.stringify(buildClaudeErrorBody(400, message)), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  const body = validation.data;

  // Estimate token count based on content length
  const messages = body.messages || [];
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          totalChars += part.text.length;
        }
      }
    }
  }

  // Rough estimate: ~4 chars per token
  const inputTokens = Math.ceil(totalChars / 4);

  return new Response(
    JSON.stringify({
      input_tokens: inputTokens,
    }),
    {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    }
  );
}
