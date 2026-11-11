import { getClientConnection } from "@/lib/db/clientConnections";
import { getLatestCallForApiKey } from "@/lib/usage/callLogs";
import { clientToolIdSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

/**
 * GET /api/cli-tools/last-seen?tool=claude-code — the latest request made with the
 * app's key, so the Connect page can flip to "Live ✓" when the first message arrives.
 */
export async function GET(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;

  const tool = new URL(request.url).searchParams.get("tool");
  const validation = validateBody(clientToolIdSchema, tool);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const connection = getClientConnection(validation.data);
  const lastSeen = connection?.apiKeyId ? getLatestCallForApiKey(connection.apiKeyId) : null;
  return Response.json({
    connected: Boolean(connection),
    connectedAt: connection?.connectedAt ?? null,
    lastSeen,
  });
}
