// Connect Codex: line-level config.toml edits that keep the user's file intact.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-connect-codex-"));
const DATA_DIR = path.join(TEST_ROOT, "data");
const CODEX_DIR = path.join(TEST_ROOT, "home", ".codex");
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
process.env.CODEX_HOME = CODEX_DIR;

const core = await import("../../src/lib/db/core.ts");
const connections = await import("../../src/lib/db/clientConnections.ts");
const modelMapDb = await import("../../src/lib/db/modelMap.ts");
const connect = await import("../../src/lib/clientConnect/index.ts");
const codex = await import("../../src/shared/services/clientConfig/codex.ts");

const CONFIG_PATH = path.join(CODEX_DIR, "config.toml");
const SETTINGS = {
  baseUrl: "http://127.0.0.1:20128/v1",
  apiKey: "sk-test",
  model: "sonnet",
  contextWindow: 200000,
};

const USER_CONFIG = [
  "# my codex setup",
  'model = "gpt-5.1-codex"',
  'approval_policy = "on-request"',
  "",
  "[model_providers.azure]",
  'name = "Azure"',
  'base_url = "https://example.openai.azure.com/openai"',
  "",
  "[mcp_servers.docs]",
  'command = "docs-mcp"',
  "",
].join("\n");

test.after(() => {
  core.resetDbInstance();
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // Windows may still hold the SQLite file.
  }
});

test("connecting sets the top-level keys and adds our provider table", () => {
  const out = codex.applyCodexConfig(USER_CONFIG, SETTINGS);
  const parsed = parseToml(out);
  assert.equal(parsed.model, "sonnet");
  assert.equal(parsed.model_provider, "coolrouter");
  assert.equal(parsed.model_context_window, 200000);
  assert.deepEqual(
    { ...parsed.model_providers.coolrouter },
    {
      name: "Cool Router",
      base_url: "http://127.0.0.1:20128/v1",
      wire_api: "responses",
      experimental_bearer_token: "sk-test",
    }
  );
  // Everything else survives, comments included.
  assert.equal(parsed.approval_policy, "on-request");
  assert.equal(parsed.model_providers.azure.name, "Azure");
  assert.equal(parsed.mcp_servers.docs.command, "docs-mcp");
  assert.ok(out.startsWith("# my codex setup\n"));
});

test("reconnecting replaces our table instead of adding a second one", () => {
  const once = codex.applyCodexConfig(USER_CONFIG, SETTINGS);
  const twice = codex.applyCodexConfig(once, { ...SETTINGS, model: "opus", contextWindow: null });
  assert.equal(twice.match(/\[model_providers\.coolrouter\]/g).length, 1);
  const parsed = parseToml(twice);
  assert.equal(parsed.model, "opus");
  assert.equal(parsed.model_context_window, undefined);
});

test("restoring puts back the original lines exactly", () => {
  const snapshot = codex.snapshotCodexConfig(USER_CONFIG);
  const connected = codex.applyCodexConfig(USER_CONFIG, SETTINGS);
  const restored = codex.restoreCodexConfig(connected, snapshot);
  const parsed = parseToml(restored);
  assert.equal(parsed.model, "gpt-5.1-codex");
  assert.equal(parsed.model_provider, undefined);
  assert.equal(parsed.model_providers.coolrouter, undefined);
  assert.equal(parsed.model_providers.azure.name, "Azure");
  assert.ok(restored.includes('model = "gpt-5.1-codex"'));
});

test("an empty or missing file gets a minimal config", () => {
  const out = codex.applyCodexConfig(null, SETTINGS);
  const parsed = parseToml(out);
  assert.equal(parsed.model, "sonnet");
  assert.equal(parsed.model_providers.coolrouter.wire_api, "responses");
  const snapshot = codex.snapshotCodexConfig(null);
  assert.equal(codex.restoreCodexConfig(out, snapshot).trim(), "");
});

test("Windows line endings and a BOM are kept working", () => {
  const crlf = "﻿" + USER_CONFIG.replace(/\n/g, "\r\n");
  const out = codex.applyCodexConfig(crlf, SETTINGS);
  assert.ok(out.includes("\r\n"));
  assert.equal(out.includes("\n") && !out.replace(/\r\n/g, "").includes("\n"), true);
  assert.equal(parseToml(out).model_provider, "coolrouter");
});

test("unsafe shapes are refused instead of edited", () => {
  assert.throws(
    () => codex.applyCodexConfig('model_providers.coolrouter.base_url = "x"\n', SETTINGS),
    codex.CodexConfigError
  );
  assert.throws(
    () => codex.applyCodexConfig('model_providers = { a = { name = "A" } }\n', SETTINGS),
    codex.CodexConfigError
  );
  assert.throws(() => codex.applyCodexConfig("model = = broken", SETTINGS), codex.CodexConfigError);
});

test("our auth sub-table goes with the provider table", () => {
  const withAuth = `${USER_CONFIG}\n[model_providers.coolrouter]\nname = "old"\n\n[model_providers.coolrouter.auth]\ncommand = "x"\n`;
  const out = codex.applyCodexConfig(withAuth, SETTINGS);
  const parsed = parseToml(out);
  assert.equal(parsed.model_providers.coolrouter.auth, undefined);
  assert.equal(parsed.model_providers.coolrouter.name, "Cool Router");
});

test("reading the connection checks provider, key and address", () => {
  const out = codex.applyCodexConfig(USER_CONFIG, SETTINGS);
  assert.deepEqual(codex.readCodexConnection(out, "sk-test"), {
    pointsHere: true,
    baseUrl: "http://127.0.0.1:20128/v1",
    model: "sonnet",
  });
  assert.equal(codex.readCodexConnection(out, "other-key").pointsHere, false);
  assert.equal(codex.readCodexConnection("[[broken", "sk-test").pointsHere, false);
});

test("connect and disconnect against a scratch CODEX_HOME", async () => {
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, USER_CONFIG);
  await modelMapDb.saveModelMapRoute("opus", ["openai/gpt-5"], { contextLength: 400000 });

  const request = new Request("http://127.0.0.1:20777/api/cli-tools/codex-settings");
  const result = await connect.connectCodex(request, "opus");
  assert.equal(result.configPath, CONFIG_PATH);

  const parsed = parseToml(fs.readFileSync(CONFIG_PATH, "utf8"));
  assert.equal(parsed.model, "opus");
  assert.equal(parsed.model_providers.coolrouter.base_url, "http://127.0.0.1:20777/v1");
  assert.equal(connections.getClientConnection("codex").route, "opus");

  const status = await connect.getCodexStatus(request);
  assert.equal(status.connected, true);
  assert.equal(status.needsUpdate, false);
  assert.equal(status.route, "opus");

  await connect.disconnectCodex();
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8").includes("coolrouter"), false);
  assert.equal(parseToml(fs.readFileSync(CONFIG_PATH, "utf8")).model, "gpt-5.1-codex");
  assert.equal(connections.getClientConnection("codex"), null);
});

test("connect leaves an invalid config untouched", async () => {
  fs.writeFileSync(CONFIG_PATH, "model = = broken\n");
  const request = new Request("http://127.0.0.1:20777/api/cli-tools/codex-settings");
  await assert.rejects(() => connect.connectCodex(request, "sonnet"), connect.ConnectError);
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), "model = = broken\n");
});
