/**
 * Dashboard session cookie — one place that signs the JWT and decides the cookie flags.
 *
 * Used by the login route, the first-run password setup (which signs the user in
 * straight away) and the proxy's sliding refresh, so all three issue the same cookie.
 *
 * The secret is read on every call rather than captured at module load: on installs
 * that start without JWT_SECRET the instrumentation hook generates it at startup, and a
 * module evaluated before that would otherwise sign with an empty key.
 *
 * @module shared/utils/authSession
 */

import { jwtVerify, SignJWT } from "jose";

export const AUTH_COOKIE_NAME = "auth_token";

/** Session lifetime. The cookie and the JWT expire together. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type HeaderReader = { get(name: string): string | null };
type SessionRequest = { headers: HeaderReader; nextUrl?: { protocol?: string }; url?: string };

export function getSessionSecret(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  return secret ? new TextEncoder().encode(secret) : null;
}

export async function createSessionToken(): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

function isHttpsRequest(request: SessionRequest): boolean {
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;
  if (request.nextUrl?.protocol === "https:") return true;
  try {
    return !!request.url && new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Cookie flags for the session. `maxAge` makes it a persistent cookie: without it the
 * browser (and the desktop app's embedded Chromium) drops the session on every restart
 * and asks for the password again.
 */
export function getSessionCookieOptions(request: SessionRequest) {
  return {
    httpOnly: true,
    secure: process.env.AUTH_COOKIE_SECURE === "true" || isHttpsRequest(request),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Verify the session cookie straight from a `Cookie` request header. Route handlers
 * normally read it through `next/headers`; this variant has no dependency on the Next.js
 * request scope.
 */
export async function hasValidSessionCookie(cookieHeader: string | null): Promise<boolean> {
  const secret = getSessionSecret();
  if (!secret || !cookieHeader) return false;
  const prefix = `${AUTH_COOKIE_NAME}=`;
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!raw) return false;
  try {
    await jwtVerify(decodeURIComponent(raw.slice(prefix.length)), secret);
    return true;
  } catch {
    return false;
  }
}
