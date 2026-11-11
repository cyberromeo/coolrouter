import {
  ConnectError,
  connectClaudeCode,
  disconnectClaudeCode,
  getClaudeCodeStatus,
  getClaudeSettingsPath,
  getLocalServerAddress,
  registerManualConnection,
  summarizeRoutes,
} from "@/lib/clientConnect";
import { isClaudeCodeInstalled } from "@/lib/clientConnect/detect";
import { buildClaudeCodeEnv } from "@/shared/services/clientConfig/claudeCode";
import { connectClaudeCodeSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

function failure(error: unknown) {
  if (error instanceof ConnectError) {
    return Response.json({ error: { message: error.message } }, { status: error.status });
  }
  console.error("[connect:claude-code]", error);
  return Response.json(
    { error: { message: "Could not update Claude Code's settings" } },
    { status: 500 }
  );
}

/** GET /api/cli-tools/claude-settings — is Claude Code installed and connected? */
export async function GET(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;
  try {
    const [status, installed] = await Promise.all([
      getClaudeCodeStatus(request),
      isClaudeCodeInstalled(),
    ]);
    const { baseUrl } = getLocalServerAddress(request);
    return Response.json({ ...status, installed, baseUrl, settingsPath: getClaudeSettingsPath() });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST /api/cli-tools/claude-settings — connect Claude Code.
 * mode "auto" writes its settings file; "manual" returns the values to paste.
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
  const validation = validateBody(connectClaudeCodeSchema, rawBody);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    if (validation.data.mode === "manual") {
      const { key, baseUrl } = await registerManualConnection("claude-code", request);
      const summary = await summarizeRoutes(request);
      const env = buildClaudeCodeEnv({
        baseUrl,
        apiKey: key.key,
        routeLabels: summary.labels,
        compactWindow: summary.smallestFirstContext,
        hasNonAnthropicModels: summary.hasNonAnthropicModels,
      });
      const visible = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== null));
      return Response.json({ mode: "manual", env: visible, settingsPath: getClaudeSettingsPath() });
    }

    const result = await connectClaudeCode(request);
    return Response.json({
      mode: "auto",
      settingsPath: result.settingsPath,
      baseUrl: result.baseUrl,
    });
  } catch (error) {
    return failure(error);
  }
}

/** DELETE /api/cli-tools/claude-settings — put Claude Code's settings back. */
export async function DELETE(request: Request) {
  const denied = await guardDashboardRequest(request, { localWrite: true });
  if (denied) return denied;
  try {
    const result = await disconnectClaudeCode();
    return Response.json({ disconnected: true, settingsPath: result.settingsPath });
  } catch (error) {
    return failure(error);
  }
}
