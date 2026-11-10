import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { generateRequestId } from "./shared/utils/requestId";
import { isPublicRoute, verifyAuth, isAuthRequired } from "./shared/utils/apiAuth";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getSessionCookieOptions,
  getSessionSecret,
} from "./shared/utils/authSession";
import { checkBodySize, getBodySizeLimit } from "./shared/middleware/bodySizeGuard";
import { isDraining } from "./lib/gracefulShutdown";
import { isModelSyncInternalRequest } from "./shared/services/modelSyncScheduler";

export async function proxy(request: any) {
  const { pathname } = request.nextUrl;

  // Pipeline: Add request ID header for end-to-end tracing
  const requestId = generateRequestId();
  const response = NextResponse.next();
  response.headers.set("X-Request-Id", requestId);

  // ──────────────── Pre-flight: Reject during shutdown drain ────────────────
  if (isDraining() && pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Server is shutting down",
          correlation_id: requestId,
        },
      },
      { status: 503 }
    );
  }

  // ──────────────── Pre-flight: Reject oversized bodies ────────────────
  if (pathname.startsWith("/api/") && request.method !== "GET" && request.method !== "OPTIONS") {
    const bodySizeRejection = checkBodySize(request, getBodySizeLimit(pathname));
    if (bodySizeRejection) return bodySizeRejection;
  }

  // ──────────────── Protect Management API Routes ────────────────
  if (pathname.startsWith("/api/")) {
    // Allow public routes (login, logout, health, the LLM proxy surface, etc.)
    if (isPublicRoute(pathname)) {
      return response;
    }

    // Allow the model auto-sync scheduler to reach only its internal provider routes.
    if (
      isModelSyncInternalRequest(request) &&
      /^\/api\/providers\/[^/]+\/(sync-models|models)$/.test(pathname)
    ) {
      return response;
    }

    // Check if auth is required at all (respects requireLogin setting)
    const authRequired = await isAuthRequired();
    if (!authRequired) {
      return response;
    }

    // Verify authentication (JWT cookie or Bearer API key)
    const authError = await verifyAuth(request);
    if (authError) {
      return NextResponse.json(
        {
          error: {
            code: "AUTH_001",
            message: authError,
            correlation_id: requestId,
          },
        },
        { status: 401 }
      );
    }
  }

  // ──────────────── Protect Dashboard Routes ────────────────
  if (pathname.startsWith("/dashboard")) {
    // Same rule as the management API (isAuthRequired): login is skipped when it is
    // turned off, or when no password exists yet — a fresh install heading into the
    // setup wizard, or one where the password step was skipped. There is nothing to sign
    // in with in that state, so sending the visitor to /login would only lock them out
    // of the page where a password can be set. On a settings read error it stays locked.
    if (!(await isAuthRequired())) {
      return response;
    }

    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    // Read the secret per request: it may have been generated at startup, after this
    // module was first evaluated.
    const secret = getSessionSecret();

    if (token && secret) {
      try {
        const { payload } = await jwtVerify(token, secret);

        // Auto-refresh: if token expires within 7 days, issue a fresh 30-day token
        const exp = payload.exp as number;
        const now = Math.floor(Date.now() / 1000);
        const REFRESH_WINDOW = 7 * 24 * 60 * 60; // 7 days in seconds
        if (exp && exp - now < REFRESH_WINDOW) {
          try {
            const freshToken = await createSessionToken();
            response.cookies.set(AUTH_COOKIE_NAME, freshToken, getSessionCookieOptions(request));
            console.log(
              `[Middleware] JWT auto-refreshed for ${pathname} (was expiring in ${Math.round((exp - now) / 3600)}h)`
            );
          } catch (refreshErr) {
            // Refresh failed — continue with existing valid token
            console.error("[Middleware] JWT auto-refresh failed:", refreshErr.message);
          }
        }

        return response;
      } catch (err) {
        // FASE-01: Log auth errors instead of silently redirecting
        console.error("[Middleware] auth_error: JWT verification failed:", err.message, {
          path: pathname,
          tokenPresent: true,
          requestId,
        });
        const redirectResponse = NextResponse.redirect(new URL("/login", request.url));
        redirectResponse.cookies.delete(AUTH_COOKIE_NAME);
        return redirectResponse;
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/api/:path*"],
};
