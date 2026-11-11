/**
 * Extra protection for dashboard routes that act on this computer (write a client's
 * config file, hand out a key) or reshape routing.
 *
 * The global guard (src/proxy.ts) also accepts a client API key as a Bearer token.
 * That is wrong for these routes: the key Cool Router writes into Claude Code's
 * settings.json sits in a plain file, so it must not be able to rewrite configs or
 * mint more keys. And with no password set, any web page the user visits could POST
 * to 127.0.0.1 — so these routes also insist on a same-origin JSON request.
 */

import { jwtVerify } from "jose";
import { isAuthRequired } from "./apiAuth";

type GuardOptions = {
  /** Writes that touch files on this computer refuse to run for a LAN-exposed, password-less server. */
  localWrite?: boolean;
};

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

function readCookie(request: Request, name: string): string | null {
  const nextCookies = (request as unknown as { cookies?: { get?: (n: string) => unknown } })
    .cookies;
  if (nextCookies && typeof nextCookies.get === "function") {
    const value = nextCookies.get(name) as { value?: string } | undefined;
    if (value?.value) return value.value;
  }
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function hasDashboardSession(request: Request): Promise<boolean> {
  const token = readCookie(request, "auth_token");
  if (!token || !process.env.JWT_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    return true;
  } catch {
    return false;
  }
}

/** True when the request comes from the dashboard's own origin (or a non-browser client). */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (host && originHost === host) return true;
    return originHost === new URL(request.url).host;
  } catch {
    return false;
  }
}

function isLanExposed(): boolean {
  const host = String(process.env.HOSTNAME || process.env.HOST || "").trim();
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

/**
 * Returns an error Response when the request may not proceed, otherwise null.
 * Use at the top of every handler of the protected routes.
 */
export async function guardDashboardRequest(
  request: Request,
  options: GuardOptions = {}
): Promise<Response | null> {
  if (!isSameOriginRequest(request)) {
    return jsonError(403, "This action is only available from the Cool Router dashboard.");
  }

  const method = request.method.toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonError(415, "Send a JSON request body.");
    }
  }

  const authRequired = await isAuthRequired();
  if (authRequired && !(await hasDashboardSession(request))) {
    return jsonError(401, "Sign in to the dashboard to do this.");
  }

  if (options.localWrite && !authRequired && isLanExposed()) {
    return jsonError(
      403,
      "Set a dashboard password first: Cool Router is reachable from other devices on your network."
    );
  }

  return null;
}
