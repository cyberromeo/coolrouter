import { getCorsOrigin } from "./cors.ts";
import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/constants.ts";
import { normalizePayloadForLog } from "@/lib/logPayloads";
import { extractErrorMessage } from "./sseDataTransform.ts";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode, message) {
  const errorInfo =
    ERROR_TYPES[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code,
    },
  };
}

// Anthropic Messages API error types by HTTP status.
const CLAUDE_ERROR_TYPES: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  429: "rate_limit_error",
  503: "overloaded_error",
  529: "overloaded_error",
};

/**
 * Build an Anthropic-compatible error response body:
 * `{ type: "error", error: { type, message } }`
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildClaudeErrorBody(statusCode: number, message?: string | null) {
  return {
    type: "error",
    error: {
      type:
        CLAUDE_ERROR_TYPES[statusCode] ||
        (statusCode >= 500 ? "api_error" : "invalid_request_error"),
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
    },
  };
}

/**
 * Re-shape an error Response from the chat pipeline (OpenAI error shape) into the shape
 * Anthropic Messages clients expect. Status and headers are kept. Successful responses,
 * non-JSON bodies and bodies already in the Anthropic shape are returned as they are.
 * @param {Response} response - Response returned by the chat pipeline
 * @returns {Promise<Response>}
 */
export async function toClaudeErrorResponse(response: Response): Promise<Response> {
  if (!response || response.ok) return response;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return response;

  const text = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const alreadyClaudeShaped =
    record?.type === "error" && !!record.error && typeof record.error === "object";

  const body =
    !record || alreadyClaudeShaped
      ? text
      : JSON.stringify(
          buildClaudeErrorBody(response.status, extractErrorMessage(record, response.statusText))
        );

  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": getCorsOrigin(),
    },
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Parse Antigravity error message to extract retry time
 * Example: "You have exhausted your capacity on this model. Your quota will reset after 2h7m23s."
 * @param {string} message - Error message
 * @returns {number|null} Retry time in milliseconds, or null if not found
 */
export function parseAntigravityRetryTime(message) {
  if (typeof message !== "string") return null;

  // Match patterns like: 2h7m23s, 5m30s, 45s, 1h20m, etc.
  const match = message.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
  if (!match) return null;

  let totalMs = 0;

  // Extract hours
  if (match[1]) {
    const hours = parseInt(match[1]);
    totalMs += hours * 60 * 60 * 1000;
  }

  // Extract minutes
  if (match[2]) {
    const minutes = parseInt(match[2]);
    totalMs += minutes * 60 * 1000;
  }

  // Extract seconds
  if (match[3]) {
    const seconds = parseInt(match[3]);
    totalMs += seconds * 1000;
  }

  return totalMs > 0 ? totalMs : null;
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {string} provider - Provider name (for Antigravity-specific parsing)
 * @returns {Promise<{statusCode: number, message: string, retryAfterMs: number|null, responseBody: unknown}>}
 */
export async function parseUpstreamError(response, provider = null) {
  let message = "";
  let retryAfterMs = null;
  let responseBody = null;

  try {
    const text = await response.text();
    responseBody = normalizePayloadForLog(text);

    // Try parse as JSON
    try {
      const json = JSON.parse(text);
      message = json.error?.message || json.message || json.error || text;
    } catch {
      message = text;
    }
  } catch {
    message = `Upstream error: ${response.status}`;
    responseBody = { _rawText: message };
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);

  // Parse Antigravity-specific retry time from error message
  if (provider === "antigravity" && response.status === 429) {
    retryAfterMs = parseAntigravityRetryTime(messageStr);
  }

  // Also parse retry time for other providers (Qwen, etc.) with "quota will reset after XhYmZs" format
  if (response.status === 429 && !retryAfterMs) {
    retryAfterMs = parseAntigravityRetryTime(messageStr);
  }

  // Cap maximum retry time at 24 hours to prevent infinite wait
  const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
  if (retryAfterMs && retryAfterMs > MAX_RETRY_MS) {
    retryAfterMs = MAX_RETRY_MS;
  }

  return {
    statusCode: response.status,
    message: messageStr,
    retryAfterMs,
    responseBody,
  };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number|null} retryAfterMs - Optional retry-after time in milliseconds
 * @returns {{ success: false, status: number, error: string, response: Response, retryAfterMs?: number }}
 */
export function createErrorResult(
  statusCode: number,
  message: string,
  retryAfterMs: number | null = null
) {
  const result: {
    success: false;
    status: number;
    error: string;
    response: Response;
    retryAfterMs?: number;
  } = {
    success: false,
    status: statusCode,
    error: message,
    response: errorResponse(statusCode, message),
  };

  // Add retryAfterMs if available (for Antigravity quota errors)
  if (retryAfterMs) {
    result.retryAfterMs = retryAfterMs;
  }

  return result;
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(
  statusCode: number,
  message: string,
  retryAfter?: string | number | Date | null,
  retryAfterHuman?: string
) {
  const retryTimeMs = retryAfter ? new Date(retryAfter).getTime() : Date.now() + 1000;
  const retryAfterSec = Math.max(Math.ceil((retryTimeMs - Date.now()) / 1000), 1);
  const msg = retryAfterHuman ? `${message} (${retryAfterHuman})` : message;
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec),
    },
  });
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  return `[${code}]: ${message}`;
}
