/**
 * Model map tiers: the three routes named after Claude's model tiers.
 *
 * Claude Code and Claude Desktop only ever ask for Claude model names
 * (`claude-opus-5-5`, `claude-sonnet-4-5-20250929`, ...). Each tier is a combo of
 * the user's own models in fallback order; mapping rules send every Claude name of
 * that tier to it. Codex and other apps ask for the route by name (`sonnet`) or for
 * `auto`.
 */

export const MODEL_MAP_TIERS = ["opus", "sonnet", "haiku"] as const;
export type ModelMapTier = (typeof MODEL_MAP_TIERS)[number];

/** Combo name used for each route. Clients can request these names directly. */
export const TIER_COMBO_NAMES: Record<ModelMapTier, string> = {
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
};

/** The Claude model id written into Claude Code / Claude Desktop for each tier. */
export const TIER_CLAUDE_MODEL_IDS: Record<ModelMapTier, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/** Marks the combos and mapping rules the model map owns. */
export const MODEL_MAP_TAG = "model-map";

/** The smallest context window Claude Code can work with (its compaction floor). */
export const MIN_CLAUDE_CODE_CONTEXT = 100_000;

/** Where a tier borrows from when it has no models of its own. */
const TIER_BORROW_ORDER: Record<ModelMapTier, ModelMapTier[]> = {
  opus: ["sonnet", "haiku"],
  sonnet: ["opus", "haiku"],
  haiku: ["sonnet", "opus"],
};

export function isModelMapTier(value: unknown): value is ModelMapTier {
  return typeof value === "string" && (MODEL_MAP_TIERS as readonly string[]).includes(value);
}

/**
 * For every tier, the tier whose models actually serve it: itself when it has
 * models, otherwise the nearest tier that does, or null when the map is empty.
 */
export function resolveServingTiers(
  hasModels: Record<ModelMapTier, boolean>
): Record<ModelMapTier, ModelMapTier | null> {
  const result = {} as Record<ModelMapTier, ModelMapTier | null>;
  for (const tier of MODEL_MAP_TIERS) {
    if (hasModels[tier]) {
      result[tier] = tier;
      continue;
    }
    result[tier] = TIER_BORROW_ORDER[tier].find((other) => hasModels[other]) ?? null;
  }
  return result;
}

export interface TierRuleSpec {
  pattern: string;
  /** The tier whose name the requests use. */
  tier: ModelMapTier;
  priority: number;
  description: string;
}

/**
 * Mapping rules (anchored, case-insensitive globs — see modelComboMappings.ts).
 * Provider-prefixed ids such as `cc/claude-…` never match, so explicit routes keep
 * working. The catch-all for other Claude names runs last.
 */
export const TIER_RULES: readonly TierRuleSpec[] = [
  { pattern: "claude-*opus*", tier: "opus", priority: 30, description: "Claude Opus names" },
  { pattern: "claude-*fable*", tier: "opus", priority: 30, description: "Claude Fable names" },
  { pattern: "claude-*sonnet*", tier: "sonnet", priority: 30, description: "Claude Sonnet names" },
  { pattern: "claude-*haiku*", tier: "haiku", priority: 30, description: "Claude Haiku names" },
  { pattern: "opus", tier: "opus", priority: 30, description: "Route name" },
  { pattern: "sonnet", tier: "sonnet", priority: 30, description: "Route name" },
  { pattern: "haiku", tier: "haiku", priority: 30, description: "Route name" },
  { pattern: "auto", tier: "sonnet", priority: 30, description: "Any app asking for auto" },
  { pattern: "claude-*", tier: "sonnet", priority: 10, description: "Other Claude names" },
];

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** Which tier a requested model name lands on, following TIER_RULES. */
export function tierForRequestedModel(modelId: string): ModelMapTier | null {
  const ordered = [...TIER_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    if (globToRegex(rule.pattern).test(modelId)) return rule.tier;
  }
  return null;
}

/** Whether a user's own mapping pattern can also capture Claude names. */
export function patternOverlapsClaudeNames(pattern: string): boolean {
  const regex = globToRegex(pattern);
  return ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "auto"].some((id) =>
    regex.test(id)
  );
}
