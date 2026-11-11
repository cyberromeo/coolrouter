// Connect Claude Code: settings.json merge, per-key undo, and the request guard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-connect-cc-"));
const DATA_DIR = path.join(TEST_ROOT, "data");
const CLAUDE_DIR = path.join(TEST_ROOT, "home", ".claude");
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.JWT_SECRET = "test-secret-for-connect";

const core = await import("../../src/lib/db/core.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const connections = await import("../../src/lib/db/clientConnections.ts");
const modelMapDb = await import("../../src/lib/db/modelMap.ts");
const connect = await import("../../src/lib/clientConnect/index.ts");
const cc = await import("../../src/shared/services/clientConfig/claudeCode.ts");
const { guardDashboardRequest, isSameOriginRequest } =
  await import("../../src/shared/utils/dashboardGuard.ts");
const { SignJWT } = await import("jose");

const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const request = () => new Request("http://127.0.0.1:20555/api/cli-tools/claude-settings");

function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
}

test.after(() => {
  core.resetDbInstance();
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // Windows may still hold the SQLite file.
  }
});

// ── Pure config functions ────────────────────────────────────────────────

test("Claude Code env uses real Claude ids, our token, and labels each tier", () => {
  const env = cc.buildClaudeCodeEnv({
    baseUrl: "http://127.0.0.1:20128/v1/",
    apiKey: "sk-test",
    routeLabels: { opus: "GPT 5", sonnet: "Deepseek Chat", haiku: null },
    compactWindow: 64000,
    hasNonAnthropicModels: true,
  });
  assert.equal(env.ANTHROPIC_BASE_URL, "http://127.0.0.1:20128");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk-test");
  assert.equal(env.ANTHROPIC_API_KEY, null);
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "claude-opus-5-5");
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-5-5");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-haiku-5-5");
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME, "Opus → GPT 5 (Cool Router)");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME, "Haiku (Cool Router)");
  // Clamped to Claude Code's 100k minimum.
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "100000");
  assert.equal(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, "1");

  const anthropicOnly = cc.buildClaudeCodeEnv({
    baseUrl: "http://127.0.0.1:20128",
    apiKey: "k",
    routeLabels: {},
    compactWindow: null,
    hasNonAnthropicModels: false,
  });
  assert.equal(anthropicOnly.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, null);
  assert.equal(anthropicOnly.CLAUDE_CODE_AUTO_COMPACT_WINDOW, null);
});

test("merging keeps every unrelated setting and restoring puts back only our keys", () => {
  const original = JSON.stringify({
    model: "opus",
    permissions: { allow: ["Bash(npm test)"] },
    env: { FOO: "bar", ANTHROPIC_API_KEY: "sk-ant-old" },
  });
  const snapshot = cc.snapshotClaudeSettings(original);
  const merged = cc.applyClaudeEnvChanges(original, {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
    ANTHROPIC_AUTH_TOKEN: "sk-new",
    ANTHROPIC_API_KEY: null,
  });
  const parsed = JSON.parse(merged);
  assert.equal(parsed.model, "opus");
  assert.deepEqual(parsed.permissions, { allow: ["Bash(npm test)"] });
  assert.equal(parsed.env.FOO, "bar");
  assert.equal(parsed.env.ANTHROPIC_API_KEY, undefined);

  // The user edits something else while connected; disconnect keeps it.
  const edited = JSON.parse(merged);
  edited.env.BAR = "baz";
  const restored = JSON.parse(cc.restoreClaudeSettings(JSON.stringify(edited), snapshot));
  assert.deepEqual(restored.env, { FOO: "bar", ANTHROPIC_API_KEY: "sk-ant-old", BAR: "baz" });
  assert.equal(restored.model, "opus");
});

test("a settings file without an env block gets none back after disconnect", () => {
  const snapshot = cc.snapshotClaudeSettings('{"theme":"dark"}');
  const merged = cc.applyClaudeEnvChanges('{"theme":"dark"}', { ANTHROPIC_AUTH_TOKEN: "x" });
  assert.deepEqual(JSON.parse(cc.restoreClaudeSettings(merged, snapshot)), { theme: "dark" });
  assert.deepEqual(JSON.parse(cc.applyClaudeEnvChanges(null, { ANTHROPIC_AUTH_TOKEN: "x" })), {
    env: { ANTHROPIC_AUTH_TOKEN: "x" },
  });
});

test("an unreadable settings file is never overwritten", () => {
  assert.throws(() => cc.snapshotClaudeSettings("{ not json"), cc.ClaudeSettingsParseError);
  assert.throws(() => cc.applyClaudeEnvChanges("[1,2]", {}), cc.ClaudeSettingsParseError);
  assert.equal(cc.readClaudeCodeConnection("{ broken", "k").pointsHere, false);
  assert.equal(cc.clampCompactWindow(5_000_000), 1_000_000);
});

// ── Connect / disconnect against a scratch home ──────────────────────────

test("connect writes settings.json, creates the app's key, and turns on the routes", async () => {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify({ model: "sonnet", env: { FOO: "bar", ANTHROPIC_API_KEY: "sk-ant-old" } })
  );
  await modelMapDb.saveModelMapRoute("sonnet", ["openai/gpt-5"]);

  const result = await connect.connectClaudeCode(request());
  assert.equal(result.settingsPath, SETTINGS_PATH);
  assert.equal(result.keyCreated, true);

  const settings = readSettings();
  assert.equal(settings.model, "sonnet");
  assert.equal(settings.env.FOO, "bar");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:20555");
  assert.equal(settings.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(await apiKeysDb.validateApiKey(settings.env.ANTHROPIC_AUTH_TOKEN));

  const connection = connections.getClientConnection("claude-code");
  assert.equal(connection.port, 20555);
  assert.equal(connection.configWritten, true);
  assert.equal((await modelMapDb.getModelMap()).rulesInstalled, true);

  const status = await connect.getClaudeCodeStatus(request());
  assert.equal(status.connected, true);
  assert.equal(status.needsUpdate, false);
  assert.equal(status.keyRevoked, false);

  // The same key is reused on reconnect.
  const again = await connect.connectClaudeCode(request());
  assert.equal(again.keyCreated, false);
  assert.equal(readSettings().env.ANTHROPIC_AUTH_TOKEN, settings.env.ANTHROPIC_AUTH_TOKEN);

  // A changed port is reported, so the page can offer "Update connections".
  const moved = await connect.getClaudeCodeStatus(
    new Request("http://127.0.0.1:20999/api/cli-tools/claude-settings")
  );
  assert.equal(moved.needsUpdate, true);
});

test("disconnect restores the original values and keeps later edits", async () => {
  const connected = readSettings();
  connected.env.LATER = "kept";
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(connected));

  await connect.disconnectClaudeCode();
  const settings = readSettings();
  assert.deepEqual(settings.env, { FOO: "bar", ANTHROPIC_API_KEY: "sk-ant-old", LATER: "kept" });
  assert.equal(settings.model, "sonnet");
  assert.equal(connections.getClientConnection("claude-code"), null);
  const backups = fs.readdirSync(path.join(DATA_DIR, "backups", "claude-code"));
  assert.ok(backups.length >= 1);
});

test("a deleted key shows as revoked and is replaced on reconnect", async () => {
  await connect.connectClaudeCode(request());
  const connection = connections.getClientConnection("claude-code");
  await apiKeysDb.deleteApiKey(connection.apiKeyId);
  assert.equal((await connect.getClaudeCodeStatus(request())).keyRevoked, true);
  const reconnected = await connect.connectClaudeCode(request());
  assert.equal(reconnected.keyCreated, true);
  await connect.disconnectClaudeCode();
});

test("connect refuses to touch an invalid settings file", async () => {
  fs.writeFileSync(SETTINGS_PATH, "{ this is not json");
  await assert.rejects(() => connect.connectClaudeCode(request()), connect.ConnectError);
  assert.equal(fs.readFileSync(SETTINGS_PATH, "utf8"), "{ this is not json");
  fs.writeFileSync(SETTINGS_PATH, "{}");
});

// ── Guard ────────────────────────────────────────────────────────────────

function guarded(headers = {}, method = "POST") {
  return new Request("http://127.0.0.1:20555/api/cli-tools/claude-settings", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : "{}",
  });
}

test("guard blocks cross-site and non-JSON requests even without a password", async () => {
  assert.equal(isSameOriginRequest(guarded({ origin: "http://127.0.0.1:20555" })), true);
  assert.equal(isSameOriginRequest(guarded({ origin: "https://evil.example" })), false);
  assert.equal(isSameOriginRequest(guarded({ "sec-fetch-site": "cross-site" })), false);

  assert.equal(
    (await guardDashboardRequest(guarded({ origin: "https://evil.example" }))).status,
    403
  );
  assert.equal(
    (await guardDashboardRequest(guarded({ "content-type": "text/plain" }))).status,
    415
  );
  assert.equal(await guardDashboardRequest(guarded()), null);
});

test("with a password, only the dashboard session passes — not a client API key", async () => {
  await settingsDb.updateSettings({ password: "hashed-placeholder", requireLogin: true });
  const machineKey = await apiKeysDb.createApiKey("client", "machine-x");

  const bearer = await guardDashboardRequest(
    guarded({ authorization: `Bearer ${machineKey.key}` })
  );
  assert.equal(bearer.status, 401);

  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  assert.equal(await guardDashboardRequest(guarded({ cookie: `auth_token=${token}` })), null);

  await settingsDb.updateSettings({ password: null, requireLogin: false });
});

test("a LAN-exposed server without a password refuses local writes", async () => {
  const previous = process.env.HOSTNAME;
  process.env.HOSTNAME = "0.0.0.0";
  try {
    const denied = await guardDashboardRequest(guarded(), { localWrite: true });
    assert.equal(denied.status, 403);
    assert.equal(await guardDashboardRequest(guarded()), null);
  } finally {
    if (previous === undefined) delete process.env.HOSTNAME;
    else process.env.HOSTNAME = previous;
  }
});

// ── Claude Desktop setup file ────────────────────────────────────────────

test("the Claude Desktop setup file uses the gateway keys and full Claude ids", async () => {
  const desktop = await import("../../src/shared/services/clientConfig/claudeDesktop.ts");
  const config = desktop.buildClaudeDesktopConfig("http://127.0.0.1:20128/v1/", "sk-desk");
  assert.deepEqual(config, {
    $schemaVersion: 1,
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: "http://127.0.0.1:20128",
    inferenceGatewayApiKey: "sk-desk",
    inferenceGatewayAuthScheme: "bearer",
    inferenceModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  });
  assert.equal(desktop.CLAUDE_DESKTOP_SETUP_FILENAME, "CoolRouter-ClaudeDesktop.json");
});

test("manual connections get their own reusable key", async () => {
  const first = await connect.registerManualConnection("other", request());
  const second = await connect.registerManualConnection("other", request());
  assert.equal(first.key.id, second.key.id);
  assert.equal(second.key.created, false);
  assert.equal(connections.getClientConnection("other").configWritten, false);
});

// ── Live check ───────────────────────────────────────────────────────────

test("the live check finds the latest request made with an app's key", async () => {
  const { saveCallLog, getLatestCallForApiKey } = await import("../../src/lib/usage/callLogs.ts");
  const { key } = await connect.registerManualConnection("claude-desktop", request());
  assert.equal(getLatestCallForApiKey(key.id), null);

  await saveCallLog({
    apiKeyId: key.id,
    model: "mock/mock-large",
    requestedModel: "claude-opus-5-5",
    provider: "openai-compatible-x",
    status: 200,
    timestamp: "2026-11-11T10:00:00.000Z",
  });
  await saveCallLog({
    apiKeyId: key.id,
    model: "mock/mock-mini",
    requestedModel: "claude-haiku-5-5",
    provider: "openai-compatible-x",
    status: 200,
    timestamp: "2026-11-11T10:05:00.000Z",
  });
  await saveCallLog({ apiKeyId: "someone-else", model: "x", status: 200 });

  const latest = getLatestCallForApiKey(key.id);
  assert.equal(latest.model, "mock/mock-mini");
  assert.equal(latest.requestedModel, "claude-haiku-5-5");
  assert.equal(latest.status, 200);
  assert.equal(getLatestCallForApiKey(""), null);
});
