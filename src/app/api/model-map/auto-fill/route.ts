import { getModelMap, isModelMapEmpty, saveModelMapRoutes } from "@/lib/db/modelMap";
import { autoFillModelMap } from "@/lib/modelMap/autoFill";
import { listMapModels } from "@/lib/modelMap/candidates";
import { MODEL_MAP_TIERS } from "@/lib/modelMap/tiers";
import { modelMapAutoFillSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { guardDashboardRequest } from "@/shared/utils/dashboardGuard";

/**
 * POST /api/model-map/auto-fill — arrange the connected models into the three routes.
 * Only fills an empty map unless `force` is set, so it never overwrites the user's
 * own arrangement by surprise. Body: { force?: boolean }
 */
export async function POST(request: Request) {
  const denied = await guardDashboardRequest(request);
  if (denied) return denied;

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }
  const validation = validateBody(modelMapAutoFillSchema, rawBody);
  if (isValidationFailure(validation)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    if (!validation.data.force && !(await isModelMapEmpty())) {
      return Response.json({ map: await getModelMap(), filled: false });
    }

    const models = await listMapModels(request);
    const routes = autoFillModelMap(models);
    if (MODEL_MAP_TIERS.every((tier) => routes[tier].length === 0)) {
      return Response.json({ map: await getModelMap(), filled: false });
    }

    const contextLengths = Object.fromEntries(
      MODEL_MAP_TIERS.map((tier) => [
        tier,
        models.find((m) => m.id === routes[tier][0])?.contextLength ?? null,
      ])
    );
    const map = await saveModelMapRoutes(routes, contextLengths);
    return Response.json({ map, filled: true });
  } catch (error) {
    console.error("[model-map] auto-fill failed:", error);
    return Response.json({ error: { message: "Could not arrange the models" } }, { status: 500 });
  }
}
