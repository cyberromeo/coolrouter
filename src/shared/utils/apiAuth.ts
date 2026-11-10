/**
 * API Authentication Guard — Shared utility for protecting management API routes.
 *
 * Provides dual-mode auth: JWT cookie (dashboard session) or Bearer API key.
 * Used by the middleware (proxy.ts) to guard /api/* management routes.
 *
 * @module shared/utils/apiAuth
 */

import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";

// ──────────────── Public Routes (No Auth Required) ────────────────

/**
 * Routes that are ALWAYS accessible without authentication.
 * An entry matches the path itself and everything below it ("/api/v1" covers "/api/v1"
 * and "/api/v1/chat/completions", but not "/api/v1beta" or "/api/v10").
 */
const PUBLIC_API_ROUTES = [
  // Auth flow — must be accessible to unauthenticated users
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",

  // Settings check — used by login page / onboarding. The POST handler polices itself:
  // it only accepts unauthenticated calls while no password exists yet.
  "/api/settings/require-login",

  // Health monitoring — probes must work without auth
  "/api/monitoring/health",

  // LLM proxy routes — use their own API key auth in the SSE layer.
  // /api/v1beta is the Gemini-format surface, /api/tags the Ollama model list; clients
  // of both send an API key (or nothing), never the dashboard session cookie.
  "/api/v1",
  "/api/v1beta",
  "/api/tags",

  // Not here on purpose: /api/oauth. Providers redirect to the /callback *page*, which
  // hands the code to the signed-in dashboard; every /api/oauth route is called from
  // there. While the prefix was public, anyone who could reach the port could attach
  // their own account as a provider connection.
];

// ──────────────── Auth Verification ────────────────

/**
 * Check if a request is authenticated via JWT cookie or Bearer API key.
 *
 * @returns null if authenticated, error message string if not
 */
export async function verifyAuth(request: any): Promise<string | null> {
  // 1. Check JWT cookie (dashboard session)
  const token = request.cookies.get("auth_token")?.value;
  if (token && process.env.JWT_SECRET) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      await jwtVerify(token, secret);
      return null; // ✔ Authenticated via cookie
    } catch {
      // Invalid/expired token — fall through to API key check
    }
  }

  // 2. Check Bearer API key
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    try {
      // Dynamic import to avoid circular dependencies during build
      const { validateApiKey } = await import("@/lib/db/apiKeys");
      const isValid = await validateApiKey(apiKey);
      if (isValid) return null; // ✔ Authenticated via API key
    } catch {
      // DB not ready or import error — deny access
    }
  }

  return "Authentication required";
}

/**
 * Check if a request is authenticated — boolean convenience wrapper for route handlers.
 *
 * Uses `cookies()` from next/headers (App Router compatible) and Bearer API key.
 * Returns true if authenticated, false otherwise.
 *
 * Unlike `verifyAuth`, this does NOT check `isAuthRequired()` — callers that
 * need to conditionally skip auth should check that separately.
 */
export async function isAuthenticated(request: Request): Promise<boolean> {
  // If settings say login/auth is disabled, treat all requests as authenticated
  if (!(await isAuthRequired())) {
    return true;
  }
  // 1. Check API key (for external clients)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    try {
      const { validateApiKey } = await import("@/lib/db/apiKeys");
      if (await validateApiKey(apiKey)) return true;
    } catch {
      // DB not ready or import error
    }
  }

  // 2. Check JWT cookie (for dashboard session)
  if (process.env.JWT_SECRET) {
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("auth_token")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);
        await jwtVerify(token, secret);
        return true;
      }
    } catch {
      // Invalid/expired token or cookies not available
    }
  }

  return false;
}

/**
 * Check if a route is in the public (no-auth) allowlist.
 */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Check if authentication is required based on settings.
 * If requireLogin is false AND no password is set, auth is skipped.
 */
export async function isAuthRequired(): Promise<boolean> {
  try {
    const settings = await getSettings();
    if (settings.requireLogin === false) return false;
    // Allow access with no password set — there's nothing to authenticate against.
    // This covers two cases:
    //   1. Fresh installs (setupComplete=false) — first-run, no password yet
    //   2. setupComplete=true but password was skipped during onboarding (#256)
    //      The user needs unauthenticated access to /dashboard/settings to set a password.
    // Note: this is safe because Bearer API key auth is still checked in verifyAuth().
    // The security concern from #151 (password row lost after being set) is handled by the
    // hasPassword flag — if a password WAS set and then somehow lost, the user can use the
    // reset-password CLI tool (bin/reset-password.mjs).
    if (!settings.password && !process.env.INITIAL_PASSWORD) return false;
    return true;
  } catch (error: any) {
    // On error, require auth (secure by default)
    // Log the error so failures (e.g., SQLITE_BUSY) aren't silent 401s
    console.error(
      "[API_AUTH_GUARD] isAuthRequired failed, defaulting to true:",
      error?.message || error
    );
    return true;
  }
}
