import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { loginSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getSessionCookieOptions,
  getSessionSecret,
} from "@/shared/utils/authSession";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request) {
  try {
    // SECURITY: no hardcoded fallback — without a signing secret nobody can sign in.
    if (!getSessionSecret()) {
      console.error("[SECURITY] JWT_SECRET is not set. Login is disabled.");
      return NextResponse.json(
        { error: "Server misconfigured: JWT_SECRET not set. Contact administrator." },
        { status: 500 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const validation = validateBody(loginSchema, rawBody);
    if (isValidationFailure(validation)) {
      const detail = validation.error.details[0]?.message;
      return NextResponse.json({ error: detail || validation.error.message }, { status: 400 });
    }
    const password = typeof validation.data.password === "string" ? validation.data.password : "";
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const settings = await getSettings();
    const storedHash = typeof settings.password === "string" ? settings.password : "";

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // SECURITY: No default password — must be set via env or onboarding
      const initialPassword = process.env.INITIAL_PASSWORD;
      if (!initialPassword) {
        return NextResponse.json(
          { error: "No password configured. Complete onboarding first.", needsSetup: true },
          { status: 403 }
        );
      }
      isValid = safeEqual(password, initialPassword);
    }

    if (!isValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(
      AUTH_COOKIE_NAME,
      await createSessionToken(),
      getSessionCookieOptions(request)
    );
    return response;
  } catch (error) {
    console.error("[AUTH] Login failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
