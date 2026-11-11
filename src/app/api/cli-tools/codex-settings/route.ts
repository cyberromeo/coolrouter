import {
  ConnectError,
  connectCodex,
  disconnectCodex,
  getCodexConfigPath,
  getCodexStatus,
  getLocalServerAddress,
  registerManualConnection,
  summarizeRoutes,
} from "@/lib/clientConnect";
import { isCodexInstalled } from "@/lib/clientConnect/detect";
import { applyCodexConfig } from "@/shared/services/clientConfig/codex";
import { connectCodexSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

function failure(error: unknown) {
  if (error instanceof ConnectError) {
    return Response.json({ error: { message: error.message } }, { status: error.status });
  }
  console.error("[connect:codex]", error);
  return Response.json({ error: { message: "Could not update Codex's config" } }, { status: 500 });
}

/** GET /api/cli-tools/codex-settings — is Codex installed and connected? */
export async function GET(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;
  try {
    const [status, installed] = await Promise.all([getCodexStatus(request), isCodexInstalled()]);
    const { baseUrl } = getLocalServerAddress(request);
    return Response.json({
      ...status,
      installed,
      baseUrl: `${baseUrl}/v1`,
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST /api/cli-tools/codex-settings — connect Codex to one route.
 * mode "auto" edits ~/.codex/config.toml; "manual" returns the block to paste.
 */
export async function POST(request: Request) {
  const denied = await guardDashboardRequest(request, { localWrite: true });
  if (denied) return denied;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }
  const validation = validateBody(connectCodexSchema, rawBody);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  const { mode, route } = validation.data;

  try {
    if (mode === "manual") {
      const { key, baseUrl } = await registerManualConnection("codex", request, route);
      const summary = await summarizeRoutes(request);
      const snippet = applyCodexConfig(null, {
        baseUrl: `${baseUrl}/v1`,
        apiKey: key.key,
        model: route,
        contextWindow: summary.contextByTier[route] ?? null,
      });
      return Response.json({ mode: "manual", snippet, configPath: getCodexConfigPath() });
    }

    const result = await connectCodex(request, route);
    return Response.json({ mode: "auto", configPath: result.configPath, route });
  } catch (error) {
    return failure(error);
  }
}

/** DELETE /api/cli-tools/codex-settings — put Codex's config back. */
export async function DELETE(request: Request) {
  const denied = await guardDashboardRequest(request, { localWrite: true });
  if (denied) return denied;
  try {
    const result = await disconnectCodex();
    return Response.json({ disconnected: true, configPath: result.configPath });
  } catch (error) {
    return failure(error);
  }
}
