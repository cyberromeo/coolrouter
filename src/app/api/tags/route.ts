import { CORS_HEADERS } from "@/shared/utils/cors";
import { getUnifiedModelsResponse } from "../v1/models/catalog";

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

type OpenAIModel = { id?: unknown; created?: unknown; owned_by?: unknown };

/**
 * GET /api/tags — the model list in Ollama's format, for clients that speak the Ollama
 * API (they pair it with POST /v1/api/chat).
 *
 * It lists the same models as GET /v1/models, with the same access rules. This used to
 * return a hard-coded pair of names ("llama3.2", "qwen2.5") that no connected provider
 * serves, so every model an Ollama client offered failed when it was picked.
 */
export async function GET(request: Request) {
  const upstream = await getUnifiedModelsResponse(request, CORS_HEADERS);
  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const message =
      (typeof body?.error === "string" ? body.error : body?.error?.message) ||
      "Failed to list models";
    return new Response(JSON.stringify({ error: message }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const data: OpenAIModel[] = Array.isArray(body?.data) ? body.data : [];
  const models = data
    .filter((model) => typeof model.id === "string" && model.id)
    .map((model) => {
      const id = model.id as string;
      const created = typeof model.created === "number" ? model.created : 0;
      return {
        name: id,
        model: id,
        modified_at: new Date(created * 1000).toISOString(),
        // Remote models have no local file; Ollama clients only display these.
        size: 0,
        digest: "",
        details: {
          format: "api",
          family: typeof model.owned_by === "string" ? model.owned_by : "",
          families: null,
          parameter_size: "",
          quantization_level: "",
        },
      };
    });

  return new Response(JSON.stringify({ models }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
