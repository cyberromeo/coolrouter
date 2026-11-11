import { getModelMap, saveModelMapRoute } from "@/lib/db/modelMap";
import { listMapModels } from "@/lib/modelMap/candidates";
import { updateModelMapRouteSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

/**
 * GET /api/model-map — the three routes plus every model the user can place.
 */
export async function GET(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;

  try {
    const [map, models] = await Promise.all([getModelMap(), listMapModels(request)]);
    return Response.json({ map, models });
  } catch (error) {
    console.error("[model-map] GET failed:", error);
    return Response.json({ error: { message: "Could not load the model map" } }, { status: 500 });
  }
}

/**
 * PUT /api/model-map — save one route's models in fallback order.
 * Body: { tier: "opus" | "sonnet" | "haiku", models: ["provider/model", ...] }
 */
export async function PUT(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }
  const validation = validateBody(updateModelMapRouteSchema, rawBody);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const { tier, models } = validation.data;
    const available = await listMapModels(request);
    const contextLength = available.find((m) => m.id === models[0])?.contextLength ?? null;
    const map = await saveModelMapRoute(tier, models, { contextLength });
    return Response.json({ map });
  } catch (error) {
    console.error("[model-map] PUT failed:", error);
    return Response.json({ error: { message: "Could not save the route" } }, { status: 500 });
  }
}
