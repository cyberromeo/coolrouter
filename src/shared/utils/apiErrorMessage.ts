/**
 * Turn an API error payload into a string that is safe to render.
 *
 * Routes answer with several shapes:
 *   { error: "text" }                                   — most handlers
 *   { error: { message, details: [{ field, message }] } } — zod validation failures
 *   { error: { code, message, correlation_id } }        — the auth gate (401)
 *   { message: "text" }                                 — a few legacy handlers
 * Rendering `data.error` directly crashes React ("Objects are not valid as a React
 * child") or prints "[object Object]" for the object shapes, so always go through this.
 *
 * @module shared/utils/apiErrorMessage
 */

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function getApiErrorMessage(payload: unknown, fallback = "Something went wrong"): string {
  if (typeof payload === "string") return payload.trim() || fallback;
  if (!payload || typeof payload !== "object") return fallback;

  const body = payload as Record<string, unknown>;
  const error = body.error;

  if (typeof error === "string") return error.trim() || fallback;

  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    const details = Array.isArray(err.details) ? err.details : [];
    const firstDetail = details.find(
      (d) => d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string"
    ) as { field?: unknown; message: string } | undefined;
    // A validation detail ("Password must be at least 4 characters") says more than the
    // generic "Invalid request" wrapper around it.
    const message = firstString(firstDetail?.message, err.message, err.error, err.code);
    if (message) return message;
  }

  return firstString(body.message, body.detail, body.statusText) || fallback;
}

/**
 * Read the error message from a failed `fetch` response without throwing on empty or
 * non-JSON bodies (proxies and crashes return HTML/plain text).
 */
export async function readApiError(
  response: Response,
  fallback = "Something went wrong"
): Promise<string> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return fallback;
  }
  if (!text) return fallback;
  try {
    return getApiErrorMessage(JSON.parse(text), fallback);
  } catch {
    return fallback;
  }
}
