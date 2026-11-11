/**
 * The "Add provider" gallery: every provider, grouped by how you pay for it.
 * Pure data shaping so the grouping and search are easy to test.
 */

export type GalleryTab = "pay" | "subscription" | "free" | "local" | "custom";

export type ConnectKind = "apikey" | "oauth" | "local" | "custom" | "details";

export interface GalleryProvider {
  id: string;
  name: string;
  /** How the simple dialog connects it; "details" opens the full provider page */
  kind: ConnectKind;
  hasFree?: boolean;
  freeNote?: string;
  website?: string;
  hint?: string;
  deprecated?: boolean;
}

export type CatalogEntry = {
  id: string;
  name: string;
  hasFree?: boolean;
  freeNote?: string;
  website?: string;
  apiHint?: string;
  authHint?: string;
  deprecated?: boolean;
};

/** Providers whose key form needs extra fields (region, base URL, service account). */
export const NEEDS_DETAILS_PAGE = new Set(["vertex", "bailian-coding-plan", "glm", "qoder"]);

export const GALLERY_TABS: GalleryTab[] = ["pay", "subscription", "free", "local", "custom"];

function toGallery(entry: CatalogEntry, kind: ConnectKind): GalleryProvider {
  return {
    id: entry.id,
    name: entry.name,
    kind: NEEDS_DETAILS_PAGE.has(entry.id) ? "details" : kind,
    hasFree: entry.hasFree,
    freeNote: entry.freeNote,
    website: entry.website,
    hint: entry.apiHint || entry.authHint,
    deprecated: entry.deprecated,
  };
}

function byName(a: GalleryProvider, b: GalleryProvider) {
  return a.name.localeCompare(b.name);
}

export function buildGallery(catalog: {
  apiKey: Record<string, CatalogEntry>;
  oauth: Record<string, CatalogEntry>;
  free: Record<string, CatalogEntry>;
}): Record<Exclude<GalleryTab, "local" | "custom">, GalleryProvider[]> {
  const pay = Object.values(catalog.apiKey).map((p) => toGallery(p, "apikey"));
  const subscription = Object.values(catalog.oauth).map((p) => toGallery(p, "oauth"));
  const freeOAuth = Object.values(catalog.free).map((p) => toGallery(p, "oauth"));
  const freeTier = [...pay, ...subscription].filter((p) => p.hasFree);

  const seen = new Set<string>();
  const free = [...freeOAuth, ...freeTier].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return {
    pay: pay.filter((p) => !p.deprecated).sort(byName),
    subscription: subscription.filter((p) => !p.deprecated).sort(byName),
    free: free.filter((p) => !p.deprecated).sort(byName),
  };
}

/** Case-insensitive match on name or id. */
export function searchGallery(list: GalleryProvider[], query: string): GalleryProvider[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(
    (p) => p.name.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle)
  );
}

/** Light check before asking the server: catches pasted spaces and obvious mix-ups. */
export function precheckApiKey(
  providerId: string,
  rawKey: string
): { key: string; error: string | null } {
  const key = rawKey.replace(/\s+/g, "");
  if (!key) return { key, error: "empty" };
  if (key.length < 8) return { key, error: "short" };
  const prefixes: Record<string, string[]> = {
    openai: ["sk-"],
    anthropic: ["sk-ant-"],
    openrouter: ["sk-or-"],
    groq: ["gsk_"],
    xai: ["xai-"],
  };
  const expected = prefixes[providerId];
  if (expected && !expected.some((prefix) => key.startsWith(prefix))) {
    return { key, error: `prefix:${expected[0]}` };
  }
  return { key, error: null };
}

/** A unique, valid prefix for a new custom provider ("My Lab" → "my-lab", "my-lab-2", ...). */
export function uniquePrefix(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "custom";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
