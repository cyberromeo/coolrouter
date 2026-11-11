import { getLocalServer, localServerBaseUrl } from "@/shared/constants/localServers";
import { localProbeSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

const PROBE_TIMEOUT_MS = 1500;

/**
 * POST /api/providers/local-probe — is a local model server running on its default
 * port, and which models does it serve? Only fixed 127.0.0.1 ports are probed;
 * the request names a server, never a host.  Body: { server: "ollama" | "lmstudio" | "llamacpp" }
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
  const validation = validateBody(localProbeSchema, rawBody);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const server = getLocalServer(validation.data.server);
  if (!server) return Response.json({ error: { message: "Unknown server" } }, { status: 400 });
  const baseUrl = localServerBaseUrl(server);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return Response.json({ reachable: false, baseUrl, models: [], status: response.status });
    }
    const data = await response.json().catch(() => null);
    const list = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];
    const models = list
      .map((entry: Record<string, unknown>) =>
        typeof entry?.id === "string"
          ? entry.id
          : typeof entry?.name === "string"
            ? entry.name
            : null
      )
      .filter((id: string | null): id is string => Boolean(id))
      .slice(0, 200);
    return Response.json({ reachable: true, baseUrl, models });
  } catch {
    return Response.json({ reachable: false, baseUrl, models: [] });
  }
}
