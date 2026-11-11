/**
 * The models a user can put on the map: every chat model of their active
 * connections, as clients see them in /v1/models, enriched with what the map shows
 * on each model (context window, price, tool calling).
 */

import { getUnifiedModelsResponse } from "@/app/api/v1/models/catalog";
import { getPricing } from "@/lib/db/settings";
import { getModelContextLimit } from "@/lib/modelsDevSync";
import { getModelSpec } from "@/shared/constants/modelSpecs";
import { supportsToolCalling } from "@coolrouter/open-sse/services/modelCapabilities.ts";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderNodes } from "@/lib/db/providers";
import type { AutoFillCandidate } from "./autoFill";

type JsonRecord = Record<string, unknown>;

export interface MapModel extends AutoFillCandidate {
  name: string;
  /** Model id as the provider knows it, without the provider prefix */
  modelId: string;
  providerName: string;
  /** Logo to show (custom providers use their API type's logo) */
  iconId: string;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function priceOf(pricing: JsonRecord, provider: string, alias: string, modelId: string) {
  const entry = asRecord(asRecord(pricing[provider])[modelId] ?? asRecord(pricing[alias])[modelId]);
  const input = typeof entry.input === "number" ? entry.input : null;
  const output = typeof entry.output === "number" ? entry.output : null;
  if (input === null && output === null) return null;
  return (input ?? 0) + (output ?? 0);
}

/** Readable label from a model id: "gpt-5-mini" → "GPT 5 Mini". */
export function prettyModelName(modelId: string): string {
  return modelId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["gpt", "glm", "qwq", "llm"].includes(lower)) return lower.toUpperCase();
      return /^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part;
    })
    .join(" ");
}

export async function listMapModels(request: Request): Promise<MapModel[]> {
  const response = await getUnifiedModelsResponse(request);
  if (!response.ok) return [];
  const payload = asRecord(await response.json());
  const entries = Array.isArray(payload.data) ? payload.data : [];
  const pricing = asRecord(await getPricing().catch(() => ({})));
  const nodes = new Map<string, JsonRecord>();
  for (const node of await getProviderNodes().catch(() => [])) {
    const record = asRecord(node);
    if (typeof record.id === "string") nodes.set(record.id, record);
  }

  const models: MapModel[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id || entry.owned_by === "combo" || entry.parent) continue;
    if (typeof entry.type === "string" && entry.type !== "chat") continue;
    if (!id.includes("/")) continue;

    const alias = id.slice(0, id.indexOf("/"));
    const modelId = typeof entry.root === "string" ? entry.root : id.slice(alias.length + 1);
    const provider = typeof entry.owned_by === "string" ? entry.owned_by : alias;
    const contextLength =
      (typeof entry.context_length === "number" ? entry.context_length : null) ??
      getModelContextLimit(provider, modelId) ??
      getModelSpec(modelId)?.contextWindow ??
      null;

    const node = nodes.get(provider);
    const nodeType = typeof node?.type === "string" ? node.type : "";
    models.push({
      id,
      provider,
      modelId,
      name: prettyModelName(modelId),
      providerName:
        (typeof node?.name === "string" && node.name) || AI_PROVIDERS[provider]?.name || provider,
      iconId: node ? (nodeType.startsWith("anthropic") ? "anthropic-m" : "oai-cc") : provider,
      contextLength,
      price: priceOf(pricing, provider, alias, modelId),
      toolCalling: supportsToolCalling(id),
    });
  }
  return models;
}
