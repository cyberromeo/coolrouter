/**
 * db/modelMap.ts — persistence for the model map (the Opus / Sonnet / Haiku routes).
 *
 * Each route is an ordinary priority combo named after its tier, so it runs through
 * the existing combo engine and shows up in /v1/models. Mapping rules tagged
 * "model-map" send Claude model names, the route names and `auto` to the right
 * combo. The rules are installed only once the user saves a route or connects an
 * app (opt-in), so an upgrade never changes how existing `claude-*` traffic routes.
 */

import { createCombo, getComboById, getComboByName, getCombos, updateCombo } from "./combos";
import {
  createModelComboMapping,
  deleteModelComboMapping,
  getModelComboMappings,
} from "./modelComboMappings";
import { getSettings, updateSettings } from "./settings";
import {
  MODEL_MAP_TAG,
  MODEL_MAP_TIERS,
  TIER_COMBO_NAMES,
  TIER_RULES,
  patternOverlapsClaudeNames,
  resolveServingTiers,
  type ModelMapTier,
} from "../modelMap/tiers";

type JsonRecord = Record<string, unknown>;

const SETTINGS_KEY = "modelMap";

interface ModelMapState {
  comboIds: Partial<Record<ModelMapTier, string>>;
  rulesInstalled: boolean;
}

export interface ModelMapRoute {
  tier: ModelMapTier;
  comboId: string | null;
  comboName: string;
  models: string[];
  /** Tier whose models serve this route (itself, a neighbour when empty, or null). */
  servedBy: ModelMapTier | null;
}

export interface ModelMapConflict {
  id: string;
  pattern: string;
  comboName: string | null;
  priority: number;
}

export interface ModelMap {
  routes: Record<ModelMapTier, ModelMapRoute>;
  rulesInstalled: boolean;
  /** The user's own enabled rules that also capture Claude names ahead of ours. */
  conflicts: ModelMapConflict[];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function comboModelIds(combo: JsonRecord | null): string[] {
  if (!combo || !Array.isArray(combo.models)) return [];
  return combo.models
    .map((entry) => (typeof entry === "string" ? entry : asRecord(entry).model))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function readState(): Promise<ModelMapState> {
  const settings = await getSettings();
  const raw = asRecord(settings[SETTINGS_KEY]);
  const comboIds: Partial<Record<ModelMapTier, string>> = {};
  const rawIds = asRecord(raw.comboIds);
  for (const tier of MODEL_MAP_TIERS) {
    if (typeof rawIds[tier] === "string") comboIds[tier] = rawIds[tier] as string;
  }
  return { comboIds, rulesInstalled: raw.rulesInstalled === true };
}

async function writeState(state: ModelMapState) {
  await updateSettings({ [SETTINGS_KEY]: state });
}

/** The combo backing a tier, when it still exists (it may have been deleted). */
async function findRouteCombo(state: ModelMapState, tier: ModelMapTier) {
  const id = state.comboIds[tier];
  if (id) {
    const byId = await getComboById(id);
    if (byId) return byId;
  }
  const byName = await getComboByName(TIER_COMBO_NAMES[tier]);
  return byName && byName.managedBy === MODEL_MAP_TAG ? byName : null;
}

/** Create the tier's combo, or adopt an existing combo with the same name. */
async function ensureRouteCombo(state: ModelMapState, tier: ModelMapTier): Promise<JsonRecord> {
  const existing =
    (await findRouteCombo(state, tier)) || (await getComboByName(TIER_COMBO_NAMES[tier]));
  if (existing) {
    state.comboIds[tier] = String(existing.id);
    if (existing.managedBy !== MODEL_MAP_TAG || existing.strategy !== "priority") {
      return (await updateCombo(String(existing.id), {
        managedBy: MODEL_MAP_TAG,
        strategy: "priority",
      })) as JsonRecord;
    }
    return existing;
  }

  const created = await createCombo({
    name: TIER_COMBO_NAMES[tier],
    models: [],
    strategy: "priority",
    managedBy: MODEL_MAP_TAG,
  });
  state.comboIds[tier] = created.id;
  return created;
}

export async function getModelMap(): Promise<ModelMap> {
  const state = await readState();
  const models = {} as Record<ModelMapTier, string[]>;
  const comboIds = {} as Record<ModelMapTier, string | null>;
  for (const tier of MODEL_MAP_TIERS) {
    const combo = await findRouteCombo(state, tier);
    comboIds[tier] = combo ? String(combo.id) : null;
    models[tier] = comboModelIds(combo);
  }

  const serving = resolveServingTiers({
    opus: models.opus.length > 0,
    sonnet: models.sonnet.length > 0,
    haiku: models.haiku.length > 0,
  });

  const routes = {} as Record<ModelMapTier, ModelMapRoute>;
  for (const tier of MODEL_MAP_TIERS) {
    routes[tier] = {
      tier,
      comboId: comboIds[tier],
      comboName: TIER_COMBO_NAMES[tier],
      models: models[tier],
      servedBy: serving[tier],
    };
  }

  const conflicts: ModelMapConflict[] = [];
  for (const rule of await getModelComboMappings()) {
    if (!rule.enabled || rule.description.startsWith(MODEL_MAP_TAG)) continue;
    if (rule.priority < 10 || !patternOverlapsClaudeNames(rule.pattern)) continue;
    conflicts.push({
      id: rule.id,
      pattern: rule.pattern,
      comboName: rule.comboName ?? null,
      priority: rule.priority,
    });
  }

  return { routes, rulesInstalled: state.rulesInstalled, conflicts };
}

/**
 * Replace the mapping rules the model map owns so they match the current routes.
 * Empty routes point at the nearest non-empty one, so neither Claude Code nor
 * Codex ever gets "model not found" while any route has a model.
 */
export async function syncModelMapRules(): Promise<void> {
  const state = await readState();
  for (const rule of await getModelComboMappings()) {
    if (rule.description.startsWith(MODEL_MAP_TAG)) {
      await deleteModelComboMapping(rule.id);
    }
  }
  if (!state.rulesInstalled) return;

  const map = await getModelMap();
  for (const spec of TIER_RULES) {
    const servingTier = map.routes[spec.tier].servedBy;
    const comboId = servingTier ? map.routes[servingTier].comboId : null;
    if (!comboId) continue;
    await createModelComboMapping({
      pattern: spec.pattern,
      comboId,
      priority: spec.priority,
      enabled: true,
      description: `${MODEL_MAP_TAG}: ${spec.description}`,
    });
  }
}

/** Opt in to sending Claude names to the routes (first save or first Connect). */
export async function enableModelMapRules(): Promise<void> {
  const state = await readState();
  if (!state.rulesInstalled) {
    state.rulesInstalled = true;
    await writeState(state);
  }
  await syncModelMapRules();
}

/** Save one route's models (in fallback order) and keep the rules in step. */
export async function saveModelMapRoute(
  tier: ModelMapTier,
  models: string[],
  options: { contextLength?: number | null } = {}
): Promise<ModelMap> {
  const state = await readState();
  const combo = await ensureRouteCombo(state, tier);
  const update: JsonRecord = {
    models: [...new Set(models.filter((m) => typeof m === "string" && m.trim()))],
    strategy: "priority",
    managedBy: MODEL_MAP_TAG,
    isActive: true,
  };
  if (typeof options.contextLength === "number" && options.contextLength > 0) {
    update.context_length = options.contextLength;
  }
  await updateCombo(String(combo.id), update);

  state.rulesInstalled = true;
  await writeState(state);
  await syncModelMapRules();
  return getModelMap();
}

/** Save all three routes at once (auto-fill). */
export async function saveModelMapRoutes(
  routes: Partial<Record<ModelMapTier, string[]>>,
  contextLengths: Partial<Record<ModelMapTier, number | null>> = {}
): Promise<ModelMap> {
  let map: ModelMap | null = null;
  for (const tier of MODEL_MAP_TIERS) {
    if (!routes[tier]) continue;
    map = await saveModelMapRoute(tier, routes[tier], { contextLength: contextLengths[tier] });
  }
  return map ?? getModelMap();
}

/** True when no route has a model yet (the map is a blank canvas). */
export async function isModelMapEmpty(): Promise<boolean> {
  const map = await getModelMap();
  return MODEL_MAP_TIERS.every((tier) => map.routes[tier].models.length === 0);
}

/** Combo ids the model map manages (for badges on the Combos page). */
export async function getModelMapComboIds(): Promise<string[]> {
  const combos = await getCombos();
  return combos.filter((c) => c.managedBy === MODEL_MAP_TAG).map((c) => String(c.id));
}
