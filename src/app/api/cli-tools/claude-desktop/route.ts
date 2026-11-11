import { getClientConnection } from "@/lib/db/clientConnections";
import { getLocalServerAddress, registerManualConnection } from "@/lib/clientConnect";
import { isClaudeDesktopInstalled } from "@/lib/clientConnect/detect";
import { getLatestCallForApiKey } from "@/lib/usage/callLogs";
import {
  buildClaudeDesktopConfig,
  CLAUDE_DESKTOP_SETUP_FILENAME,
} from "@/shared/services/clientConfig/claudeDesktop";
import { connectOtherAppSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

/** GET /api/cli-tools/claude-desktop — installed? set up? */
export async function GET(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;
  const connection = getClientConnection("claude-desktop");
  const { baseUrl, port } = getLocalServerAddress(request);
  return Response.json({
    installed: await isClaudeDesktopInstalled(),
    connected: Boolean(connection),
    needsUpdate: Boolean(connection?.port && connection.port !== port),
    baseUrl,
    connectedAt: connection?.connectedAt ?? null,
    lastSeen: connection?.apiKeyId ? getLatestCallForApiKey(connection.apiKeyId) : null,
  });
}

/**
 * POST /api/cli-tools/claude-desktop — create Claude Desktop's key and return the
 * setup file to import. The dashboard saves it as a download.
 */
export async function POST(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }
  const validation = validateBody(connectOtherAppSchema, rawBody);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const { key, baseUrl } = await registerManualConnection("claude-desktop", request);
    return Response.json(
      {
        filename: CLAUDE_DESKTOP_SETUP_FILENAME,
        config: buildClaudeDesktopConfig(baseUrl, key.key),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[connect:claude-desktop]", error);
    return Response.json(
      { error: { message: "Could not create the setup file" } },
      { status: 500 }
    );
  }
}
