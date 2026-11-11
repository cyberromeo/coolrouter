import { registerManualConnection } from "@/lib/clientConnect";
import { connectOtherAppSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

/**
 * POST /api/cli-tools/other — the key and address for any OpenAI- or
 * Anthropic-compatible app ("My apps" key, created once and reused).
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
    const { key, baseUrl } = await registerManualConnection("other", request);
    return Response.json(
      { apiKey: key.key, baseUrl, openaiBaseUrl: `${baseUrl}/v1`, model: "auto" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[connect:other]", error);
    return Response.json({ error: { message: "Could not create a key" } }, { status: 500 });
  }
}
