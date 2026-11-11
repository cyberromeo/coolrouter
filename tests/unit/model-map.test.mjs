// Model map: the Opus / Sonnet / Haiku routes and the rules that send Claude
// model names to them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-model-map-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelMapDb = await import("../../src/lib/db/modelMap.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const mappingsDb = await import("../../src/lib/db/modelComboMappings.ts");
const tiers = await import("../../src/lib/modelMap/tiers.ts");
const { autoFillModelMap, sizeFromName, interleaveProviders } =
  await import("../../src/lib/modelMap/autoFill.ts");
const { prettyModelName } = await import("../../src/lib/modelMap/candidates.ts");
const { getComboForModel } = await import("../../src/sse/services/model.ts");

function resetDb() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(() => resetDb());
test.after(() => {
  core.resetDbInstance();
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite file locked briefly; the OS temp cleaner gets it.
  }
});

// ── Tiers ────────────────────────────────────────────────────────────────

test("Claude model names of every generation land on their tier", () => {
  const cases = {
    "claude-opus-5-5": "opus",
    "claude-opus-4-1-20250805": "opus",
    "claude-3-opus-20240229": "opus",
    "claude-fable-5-2": "opus",
    "claude-sonnet-4-5-20250929": "sonnet",
    "claude-sonnet-5-5[1m]": "sonnet",
    "claude-3-5-haiku-20241022": "haiku",
    "CLAUDE-HAIKU-5-5": "haiku",
    "claude-instant-1.2": "sonnet",
    sonnet: "sonnet",
    auto: "sonnet",
  };
  for (const [model, tier] of Object.entries(cases)) {
    assert.equal(tiers.tierForRequestedModel(model), tier, model);
  }
});

test("provider-prefixed and unrelated names never match a tier", () => {
  for (const model of ["cc/claude-opus-4-6", "anthropic/claude-sonnet-4-5", "gpt-5", "my-claude"]) {
    assert.equal(tiers.tierForRequestedModel(model), null, model);
  }
});

test("empty routes borrow from the nearest route that has models", () => {
  assert.deepEqual(tiers.resolveServingTiers({ opus: false, sonnet: true, haiku: false }), {
    opus: "sonnet",
    sonnet: "sonnet",
    haiku: "sonnet",
  });
  assert.deepEqual(tiers.resolveServingTiers({ opus: true, sonnet: false, haiku: true }), {
    opus: "opus",
    sonnet: "opus",
    haiku: "haiku",
  });
  assert.deepEqual(tiers.resolveServingTiers({ opus: false, sonnet: false, haiku: false }), {
    opus: null,
    sonnet: null,
    haiku: null,
  });
});

test("only user rules that can capture Claude names count as overlapping", () => {
  assert.equal(tiers.patternOverlapsClaudeNames("claude-*"), true);
  assert.equal(tiers.patternOverlapsClaudeNames("*"), true);
  assert.equal(tiers.patternOverlapsClaudeNames("gpt-*"), false);
});

// ── Auto-fill ────────────────────────────────────────────────────────────

test("name size uses whole tokens, so minimax is not 'mini' or 'max'", () => {
  assert.equal(sizeFromName("openai/gpt-5-mini"), -1);
  assert.equal(sizeFromName("gemini/gemini-2.5-flash"), -1);
  assert.equal(sizeFromName("gemini/gemini-2.5-pro"), 1);
  assert.equal(sizeFromName("minimax/MiniMax-M2"), 0);
  assert.equal(sizeFromName("deepseek/deepseek-chat"), 0);
});

test("auto-fill ranks by price: expensive → opus, cheap → haiku", () => {
  const routes = autoFillModelMap([
    { id: "openai/gpt-5", provider: "openai", price: 11.25, contextLength: 400000 },
    { id: "anthropic/claude-opus-4-1", provider: "anthropic", price: 90, contextLength: 200000 },
    { id: "deepseek/deepseek-chat", provider: "deepseek", price: 1.4, contextLength: 128000 },
    { id: "gemini/gemini-2.5-pro", provider: "gemini", price: 11.25, contextLength: 1048576 },
    { id: "gemini/gemini-2.5-flash", provider: "gemini", price: 2.8, contextLength: 1048576 },
    { id: "groq/llama-3.1-8b-instant", provider: "groq", price: 0.13, contextLength: 131072 },
  ]);
  assert.equal(routes.opus[0], "anthropic/claude-opus-4-1");
  assert.ok(
    routes.sonnet.includes("gemini/gemini-2.5-pro") || routes.sonnet.includes("openai/gpt-5")
  );
  assert.equal(routes.haiku.includes("groq/llama-3.1-8b-instant"), true);
  for (const tier of tiers.MODEL_MAP_TIERS) {
    assert.ok(routes[tier].length >= 1 && routes[tier].length <= 3, tier);
  }
});

test("auto-fill skips models Claude Code can't use and fills every route from one model", () => {
  const routes = autoFillModelMap([
    { id: "a/tiny-context", provider: "a", contextLength: 8192 },
    { id: "b/no-tools", provider: "b", toolCalling: false, contextLength: 200000 },
    { id: "c/good", provider: "c", contextLength: 200000 },
  ]);
  assert.deepEqual(routes, { opus: ["c/good"], sonnet: ["c/good"], haiku: ["c/good"] });
  assert.deepEqual(autoFillModelMap([]), { opus: [], sonnet: [], haiku: [] });
});

test("fallbacks alternate providers where they can", () => {
  const ordered = interleaveProviders([
    { id: "a/1", provider: "a" },
    { id: "a/2", provider: "a" },
    { id: "b/1", provider: "b" },
  ]).map((m) => m.id);
  assert.deepEqual(ordered, ["a/1", "b/1", "a/2"]);
});

test("model ids get readable names", () => {
  assert.equal(prettyModelName("gpt-5-mini"), "GPT 5 Mini");
  assert.equal(prettyModelName("deepseek-chat"), "Deepseek Chat");
});

// ── Persistence and routing ──────────────────────────────────────────────

test("a fresh install has an empty map and no rules (opt-in)", async () => {
  const map = await modelMapDb.getModelMap();
  assert.equal(map.rulesInstalled, false);
  assert.equal(await modelMapDb.isModelMapEmpty(), true);
  assert.equal((await mappingsDb.getModelComboMappings()).length, 0);
  assert.equal(await getComboForModel("claude-opus-5-5"), null);
});

test("saving a route creates its combo and routes Claude names to it", async () => {
  const map = await modelMapDb.saveModelMapRoute(
    "opus",
    ["openai/gpt-5", "deepseek/deepseek-chat"],
    {
      contextLength: 400000,
    }
  );

  assert.equal(map.rulesInstalled, true);
  assert.deepEqual(map.routes.opus.models, ["openai/gpt-5", "deepseek/deepseek-chat"]);
  const combo = await combosDb.getComboByName("opus");
  assert.equal(combo.strategy, "priority");
  assert.equal(combo.managedBy, "model-map");
  assert.equal(combo.context_length, 400000);

  // Every tier is served by the only route that has models.
  for (const name of [
    "claude-opus-5-5",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-5-5",
    "auto",
  ]) {
    const routed = await getComboForModel(name);
    assert.equal(routed?.name, "opus", name);
  }
  assert.equal((await getComboForModel("sonnet"))?.name, "opus");
  assert.equal(await getComboForModel("gpt-5"), null);
});

test("each tier gets its own route once it has models", async () => {
  await modelMapDb.saveModelMapRoutes({
    opus: ["openai/gpt-5"],
    sonnet: ["deepseek/deepseek-chat"],
    haiku: ["gemini/gemini-2.5-flash"],
  });
  assert.equal((await getComboForModel("claude-opus-5-5"))?.name, "opus");
  assert.equal((await getComboForModel("claude-sonnet-5-5"))?.name, "sonnet");
  assert.equal((await getComboForModel("claude-3-5-haiku-20241022"))?.name, "haiku");
  assert.equal((await getComboForModel("claude-instant-1"))?.name, "sonnet");

  // Re-syncing replaces only the model map's own rules.
  const before = await mappingsDb.getModelComboMappings();
  await modelMapDb.syncModelMapRules();
  const after = await mappingsDb.getModelComboMappings();
  assert.equal(after.length, before.length);
  assert.ok(after.every((rule) => rule.description.startsWith("model-map")));
});

test("emptying a route sends its names to a neighbour instead of failing", async () => {
  await modelMapDb.saveModelMapRoutes({
    opus: ["openai/gpt-5"],
    sonnet: ["deepseek/deepseek-chat"],
  });
  await modelMapDb.saveModelMapRoute("sonnet", []);
  assert.equal((await getComboForModel("claude-sonnet-5-5"))?.name, "opus");
  assert.equal((await getComboForModel("sonnet"))?.name, "opus");
});

test("an existing user combo named 'sonnet' is adopted, and user rules are kept and reported", async () => {
  const userCombo = await combosDb.createCombo({
    name: "sonnet",
    models: ["openai/gpt-4o"],
    strategy: "round-robin",
  });
  const target = await combosDb.createCombo({ name: "everything", models: ["openai/gpt-4o"] });
  await mappingsDb.createModelComboMapping({
    pattern: "claude-*",
    comboId: target.id,
    priority: 50,
    description: "my catch-all",
  });

  const map = await modelMapDb.saveModelMapRoute("sonnet", ["deepseek/deepseek-chat"]);
  assert.equal(map.routes.sonnet.comboId, userCombo.id);
  const adopted = await combosDb.getComboById(userCombo.id);
  assert.equal(adopted.strategy, "priority");
  assert.deepEqual(adopted.models, ["deepseek/deepseek-chat"]);

  assert.equal(map.conflicts.length, 1);
  assert.equal(map.conflicts[0].pattern, "claude-*");
  const rules = await mappingsDb.getModelComboMappings();
  assert.ok(rules.some((rule) => rule.description === "my catch-all"));
});

test("enableModelMapRules opts in without a route save", async () => {
  await combosDb.createCombo({ name: "x", models: [] });
  await modelMapDb.enableModelMapRules();
  assert.equal((await modelMapDb.getModelMap()).rulesInstalled, true);
  // No models anywhere yet, so there is nothing to route to.
  assert.equal((await mappingsDb.getModelComboMappings()).length, 0);
  assert.deepEqual(await modelMapDb.getModelMapComboIds(), []);
});
