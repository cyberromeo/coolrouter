import type { ModelMapTier } from "@/lib/modelMap/tiers";

/** Visual identity of each route on the map and in lists. */
export const TIER_META: Record<
  ModelMapTier,
  { icon: string; colorVar: string; claudeName: string }
> = {
  opus: { icon: "workspace_premium", colorVar: "var(--tier-opus)", claudeName: "Opus" },
  sonnet: { icon: "auto_awesome", colorVar: "var(--tier-sonnet)", claudeName: "Sonnet" },
  haiku: { icon: "bolt", colorVar: "var(--tier-haiku)", claudeName: "Haiku" },
};

export const TIERS: ModelMapTier[] = ["opus", "sonnet", "haiku"];

export function formatContext(tokens?: number | null): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}k`;
}
