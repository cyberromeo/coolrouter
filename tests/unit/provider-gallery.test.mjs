// The "Add provider" gallery: grouping by how you pay, search, and the light
// key check that runs before the server validates a key.
import test from "node:test";
import assert from "node:assert/strict";

const gallery = await import("../../src/app/(dashboard)/dashboard/providers/providerGallery.ts");
const { APIKEY_PROVIDERS, OAUTH_PROVIDERS, FREE_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");
const { LOCAL_SERVERS, getLocalServer, localServerBaseUrl } =
  await import("../../src/shared/constants/localServers.ts");

const groups = gallery.buildGallery({
  apiKey: APIKEY_PROVIDERS,
  oauth: OAUTH_PROVIDERS,
  free: FREE_PROVIDERS,
});

test("every provider in the catalog appears in the gallery", () => {
  const shown = new Set([...groups.pay, ...groups.subscription, ...groups.free].map((p) => p.id));
  const catalog = [
    ...Object.values(APIKEY_PROVIDERS),
    ...Object.values(OAUTH_PROVIDERS),
    ...Object.values(FREE_PROVIDERS),
  ].filter((p) => !p.deprecated);
  for (const provider of catalog) {
    assert.ok(shown.has(provider.id), `${provider.id} missing from the gallery`);
  }
});

test("tabs follow how you pay, sorted by name", () => {
  assert.ok(groups.pay.some((p) => p.id === "openai" && p.kind === "apikey"));
  assert.ok(groups.subscription.some((p) => p.id === "claude" && p.kind === "oauth"));
  assert.ok(groups.free.every((p) => p.hasFree || FREE_PROVIDERS[p.id]));
  const names = groups.pay.map((p) => p.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b))
  );
  assert.equal(new Set(groups.free.map((p) => p.id)).size, groups.free.length);
});

test("providers needing extra fields open their details page", () => {
  const vertex = [...groups.pay, ...groups.subscription].find((p) => p.id === "vertex");
  assert.equal(vertex?.kind, "details");
});

test("search matches name or id, case-insensitively", () => {
  const results = gallery.searchGallery(groups.pay, "DEEPSEEK");
  assert.ok(results.some((p) => p.id === "deepseek"));
  assert.equal(gallery.searchGallery(groups.pay, "   ").length, groups.pay.length);
  assert.equal(gallery.searchGallery(groups.pay, "no-such-provider-xyz").length, 0);
});

test("the key precheck trims pasted whitespace and catches obvious mix-ups", () => {
  assert.deepEqual(gallery.precheckApiKey("openai", "  sk-abc123456789 \n"), {
    key: "sk-abc123456789",
    error: null,
  });
  assert.equal(gallery.precheckApiKey("openai", "").error, "empty");
  assert.equal(gallery.precheckApiKey("openai", "sk-1").error, "short");
  assert.equal(gallery.precheckApiKey("anthropic", "sk-proj-1234567890").error, "prefix:sk-ant-");
  assert.equal(gallery.precheckApiKey("deepseek", "anything-long-enough").error, null);
});

test("custom provider prefixes are unique and URL-safe", () => {
  assert.equal(gallery.uniquePrefix("My Lab!", []), "my-lab");
  assert.equal(gallery.uniquePrefix("My Lab", ["my-lab", "my-lab-2"]), "my-lab-3");
  assert.equal(gallery.uniquePrefix("???", []), "custom");
});

test("local servers have fixed loopback addresses", () => {
  assert.deepEqual(
    LOCAL_SERVERS.map((s) => s.id),
    ["ollama", "lmstudio", "llamacpp"]
  );
  assert.equal(localServerBaseUrl(getLocalServer("ollama")), "http://127.0.0.1:11434/v1");
  assert.equal(getLocalServer("elsewhere"), undefined);
});
