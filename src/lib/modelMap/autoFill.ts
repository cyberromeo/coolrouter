/**
 * Auto-fill: a sensible first model map from whatever models the user connected.
 *
 * Only models Claude Code can actually work with are used: chat models with tool
 * calling and a context window of at least 100k tokens (when the window is known).
 * Models are ranked by price — the clearest signal of capability available for
 * every provider — and split into three bands: most expensive → Opus, middle →
 * Sonnet, cheapest → Haiku. When prices are unknown, the model name decides.
 * The result is only a starting point; the user rearranges it on the map.
 */

import { MIN_CLAUDE_CODE_CONTEXT, MODEL_MAP_TIERS, type ModelMapTier } from "./tiers";

export interface AutoFillCandidate {
  /** Routable id, e.g. "openai/gpt-5" */
  id: string;
  /** Provider id or alias, used to mix providers along a route */
  provider: string;
  contextLength?: number | null;
  /** Blended $ per 1M tokens (input + output), when known */
  price?: number | null;
  toolCalling?: boolean | null;
}

export const MAX_MODELS_PER_ROUTE = 3;

const LARGE_TOKENS = new Set(["opus", "pro", "large", "ultra", "max", "405b", "maverick"]);
const SMALL_TOKENS = new Set([
  "mini",
  "flash",
  "haiku",
  "small",
  "lite",
  "nano",
  "tiny",
  "air",
  "1b",
  "3b",
  "7b",
  "8b",
  "9b",
]);

/** -1 small, 0 medium, 1 large — judged from name tokens, never substrings. */
export function sizeFromName(modelId: string): -1 | 0 | 1 {
  const name = modelId.split("/").pop() || modelId;
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.some((t) => SMALL_TOKENS.has(t))) return -1;
  if (tokens.some((t) => LARGE_TOKENS.has(t))) return 1;
  return 0;
}

function isUsableForClaudeCode(model: AutoFillCandidate): boolean {
  if (model.toolCalling === false) return false;
  if (typeof model.contextLength === "number" && model.contextLength > 0) {
    return model.contextLength >= MIN_CLAUDE_CODE_CONTEXT;
  }
  return true;
}

/** Reorder so consecutive models come from different providers where possible. */
export function interleaveProviders(models: AutoFillCandidate[]): AutoFillCandidate[] {
  const remaining = [...models];
  const result: AutoFillCandidate[] = [];
  while (remaining.length > 0) {
    const last = result.at(-1)?.provider;
    const index = remaining.findIndex((m) => m.provider !== last);
    result.push(...remaining.splice(index === -1 ? 0 : index, 1));
  }
  return result;
}

function splitIntoBands(ranked: AutoFillCandidate[]): Record<ModelMapTier, AutoFillCandidate[]> {
  const knownPrices = ranked.filter((m) => typeof m.price === "number");
  if (knownPrices.length >= Math.ceil(ranked.length / 2) && knownPrices.length >= 2) {
    const sorted = [...ranked].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    const third = Math.max(1, Math.round(sorted.length / 3));
    return {
      opus: sorted.slice(0, third),
      sonnet: sorted.slice(third, sorted.length - third),
      haiku: sorted.slice(Math.max(third, sorted.length - third)),
    };
  }

  const bands: Record<ModelMapTier, AutoFillCandidate[]> = { opus: [], sonnet: [], haiku: [] };
  for (const model of ranked) {
    const size = sizeFromName(model.id);
    bands[size === 1 ? "opus" : size === -1 ? "haiku" : "sonnet"].push(model);
  }
  return bands;
}

/**
 * Build routes from the candidates. Every route ends up with at least one model
 * when any model is usable; a route whose band is empty borrows its neighbours'.
 */
export function autoFillModelMap(candidates: AutoFillCandidate[]): Record<ModelMapTier, string[]> {
  const seen = new Set<string>();
  const unique = candidates.filter((m) => {
    if (!m?.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  const usable = unique.filter(isUsableForClaudeCode);
  const pool = usable.length > 0 ? usable : unique.filter((m) => m.toolCalling !== false);

  const result: Record<ModelMapTier, string[]> = { opus: [], sonnet: [], haiku: [] };
  if (pool.length === 0) return result;

  const bands = splitIntoBands(pool);
  const neighbours: Record<ModelMapTier, ModelMapTier[]> = {
    opus: ["sonnet", "haiku"],
    sonnet: ["opus", "haiku"],
    haiku: ["sonnet", "opus"],
  };

  for (const tier of MODEL_MAP_TIERS) {
    const own = interleaveProviders(bands[tier]);
    const borrowed = neighbours[tier].flatMap((other) => bands[other]);
    // A route of one model gets a fallback from the neighbouring band.
    const wanted = own.length >= 2 ? own : [...own, ...borrowed];
    result[tier] = wanted.slice(0, MAX_MODELS_PER_ROUTE).map((m) => m.id);
  }
  return result;
}
