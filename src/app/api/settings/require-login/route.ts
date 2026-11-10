import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { updateRequireLoginSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getSessionCookieOptions,
  getSessionSecret,
  hasValidSessionCookie,
} from "@/shared/utils/authSession";

// Node.js compatibility. If this handler is answering at all, the native SQLite module
// loaded, so the only thing left to flag is a runtime older than Next.js itself supports.
function getNodeCompatibility() {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  return { nodeVersion, nodeCompatible: Number.isFinite(major) ? major >= 20 : true };
}

export async function GET() {
  const nodeInfo = getNodeCompatibility();
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    const hasPassword = !!settings.password || !!process.env.INITIAL_PASSWORD;
    const setupComplete = !!settings.setupComplete;
    // True while the instance still signs in with INITIAL_PASSWORD from the environment
    // (no password saved in Settings yet) — the login page shows a hint only then.
    const initialPasswordActive = !settings.password && !!process.env.INITIAL_PASSWORD;
    return NextResponse.json({
      requireLogin,
      hasPassword,
      setupComplete,
      initialPasswordActive,
      ...nodeInfo,
    });
  } catch (error) {
    console.error("[API] Error fetching require-login settings:", error);
    return NextResponse.json(
      { requireLogin: true, hasPassword: true, setupComplete: true, ...nodeInfo },
      { status: 200 }
    );
  }
}

async function callerIsSignedIn(request: Request): Promise<boolean> {
  if (await isAuthenticated(request)) return true;
  return hasValidSessionCookie(request.headers.get("cookie"));
}

/**
 * POST /api/settings/require-login — security step of the first-run setup wizard.
 *
 * This route is on the public allowlist (the wizard runs before any password exists),
 * so it polices itself:
 *   - No password yet: anyone may set the first password or turn login off. Setting a
 *     password also signs the caller in (session cookie); without that, every request
 *     the wizard makes afterwards is rejected as unauthenticated.
 *   - A password already exists: the caller must be signed in, and the password cannot
 *     be replaced here — that goes through Settings → Security, which asks for the
 *     current one. Otherwise anyone who can reach the port could reset it.
 */
export async function POST(request: Request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    const validation = validateBody(updateRequireLoginSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { requireLogin, password } = validation.data;

    const settings = await getSettings();
    const hasPassword = !!settings.password || !!process.env.INITIAL_PASSWORD;

    if (hasPassword) {
      if (!(await callerIsSignedIn(request))) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (password) {
        return NextResponse.json(
          { error: "A password is already set. Change it in Settings → Security." },
          { status: 409 }
        );
      }
    }

    const updates: Record<string, unknown> = {};

    if (typeof requireLogin === "boolean") {
      updates.requireLogin = requireLogin;
    }

    if (password) {
      updates.password = await bcrypt.hash(password, 12);
      // A password only protects anything while login is on.
      if (typeof requireLogin !== "boolean") updates.requireLogin = true;
    }

    await updateSettings(updates);

    const response = NextResponse.json({ success: true });
    if (password && getSessionSecret()) {
      response.cookies.set(
        AUTH_COOKIE_NAME,
        await createSessionToken(),
        getSessionCookieOptions(request)
      );
    }
    return response;
  } catch (error) {
    console.error("[API] Error updating require-login settings:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
