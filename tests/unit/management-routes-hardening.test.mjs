import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-mgmt-routes-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.STORAGE_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const gracefulShutdown = await import("../../src/lib/gracefulShutdown.ts");
const faviconRoute = await import("../../src/app/api/settings/favicon/route.ts");
const modelsDevRoute = await import("../../src/app/api/settings/models-dev/route.ts");
const cacheConfigRoute = await import("../../src/app/api/settings/cache-config/route.ts");
const logsDetailRoute = await import("../../src/app/api/logs/detail/route.ts");
const providersClientRoute = await import("../../src/app/api/providers/client/route.ts");
const importJsonRoute = await import("../../src/app/api/settings/import-json/route.ts");
const healthRoute = await import("../../src/app/api/monitoring/health/route.ts");
const oauthActionRoute = await import("../../src/app/api/oauth/[provider]/[action]/route.ts");
const cursorImportRoute = await import("../../src/app/api/oauth/cursor/import/route.ts");
const kiroImportRoute = await import("../../src/app/api/oauth/kiro/import/route.ts");
const kiroSocialAuthorizeRoute =
  await import("../../src/app/api/oauth/kiro/social-authorize/route.ts");
const kiroSocialExchangeRoute =
  await import("../../src/app/api/oauth/kiro/social-exchange/route.ts");

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function resetStorage() {
  delete process.env.INITIAL_PASSWORD;
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  delete process.env.INITIAL_PASSWORD;
  // The health route pulls in the local-provider sweep, which re-arms a timer forever
  const { stopLocalHealthCheck } = await import("../../src/lib/localHealthCheck.ts");
  stopLocalHealthCheck();
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("requestProcessShutdown runs the SIGTERM handlers on Windows instead of killing", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalKill = process.kill;
  const killCalls = [];
  let handled = 0;
  const listener = () => {
    handled++;
  };

  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  process.kill = (pid, signal) => {
    killCalls.push({ pid, signal });
    return true;
  };
  process.on("SIGTERM", listener);

  try {
    gracefulShutdown.requestProcessShutdown();
    assert.equal(handled, 1);
    assert.deepEqual(killCalls, []);
  } finally {
    process.off("SIGTERM", listener);
    process.kill = originalKill;
    Object.defineProperty(process, "platform", platform);
  }
});

test("requestProcessShutdown signals the process on POSIX", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalKill = process.kill;
  const killCalls = [];

  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  process.kill = (pid, signal) => {
    killCalls.push({ pid, signal });
    return true;
  };

  try {
    gracefulShutdown.requestProcessShutdown();
    assert.deepEqual(killCalls, [{ pid: process.pid, signal: "SIGTERM" }]);
  } finally {
    process.kill = originalKill;
    Object.defineProperty(process, "platform", platform);
  }
});

test("GET /api/settings/favicon redirects to the default icon instead of throwing", async () => {
  const response = await faviconRoute.GET(
    new Request("http://localhost:20128/api/settings/favicon")
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:20128/favicon.svg");
});

test("settings routes answer schema failures with 400 instead of an empty 500", async () => {
  const modelsDev = await modelsDevRoute.POST(
    jsonRequest("http://localhost/api/settings/models-dev", "POST", { action: "bogus" })
  );
  assert.equal(modelsDev.status, 400);
  assert.equal((await modelsDev.json()).error.message, "Invalid request");

  const cacheConfig = await cacheConfigRoute.PUT(
    jsonRequest("http://localhost/api/settings/cache-config", "PUT", {
      semanticCacheEnabled: "nope",
    })
  );
  assert.equal(cacheConfig.status, 400);
  assert.equal((await cacheConfig.json()).error.message, "Invalid request");
});

test("POST /api/logs/detail rejects malformed and non-object bodies with 400", async () => {
  const malformed = await logsDetailRoute.POST(
    jsonRequest("http://localhost/api/logs/detail", "POST", "{")
  );
  assert.equal(malformed.status, 400);

  const notAnObject = await logsDetailRoute.POST(
    jsonRequest("http://localhost/api/logs/detail", "POST", "null")
  );
  assert.equal(notAnObject.status, 400);

  const ok = await logsDetailRoute.POST(
    jsonRequest("http://localhost/api/logs/detail", "POST", { enabled: true })
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).enabled, true);
});

test("GET /api/providers/client never returns credentials", async () => {
  await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "secret-holder",
    apiKey: "sk-should-not-leave-the-server",
    isActive: true,
  });
  await providersDb.createProviderConnection({
    provider: "claude",
    authType: "oauth",
    email: "user@example.com",
    accessToken: "access-should-not-leave",
    refreshToken: "refresh-should-not-leave",
    idToken: "id-should-not-leave",
  });

  const response = await providersClientRoute.GET();
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.equal(body.connections.length, 2);
  assert.equal(text.includes("should-not-leave"), false);
  for (const connection of body.connections) {
    for (const field of ["apiKey", "accessToken", "refreshToken", "idToken"]) {
      assert.equal(field in connection, false, `${field} must be stripped`);
    }
  }
  assert.deepEqual(body.connections.map((c) => c.provider).sort(), ["claude", "openai"]);
});

test("POST /api/settings/import-json rejects a non-object backup with 400", async () => {
  for (const payload of ["null", "[]", '"text"']) {
    const response = await importJsonRoute.POST(
      jsonRequest("http://localhost/api/settings/import-json", "POST", payload)
    );
    assert.equal(response.status, 400, `payload ${payload}`);
  }
});

test("POST /api/settings/import-json stores imported credentials encrypted at rest", async () => {
  const response = await importJsonRoute.POST(
    jsonRequest("http://localhost/api/settings/import-json", "POST", {
      providerConnections: [
        {
          id: "imported-conn",
          provider: "openai",
          authType: "apikey",
          name: "imported",
          apiKey: "sk-imported-plaintext",
        },
      ],
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).connections, 1);

  const raw = core
    .getDbInstance()
    .prepare("SELECT api_key FROM provider_connections WHERE id = ?")
    .get("imported-conn");
  assert.equal(String(raw.api_key).startsWith("enc:v1:"), true, "stored value must be encrypted");

  const [connection] = await providersDb.getProviderConnections({ provider: "openai" });
  assert.equal(connection.apiKey, "sk-imported-plaintext");
});

test("OAuth management routes require authentication once a password exists", async () => {
  process.env.INITIAL_PASSWORD = "bootstrap-password";
  const params = (action) => ({ params: Promise.resolve({ provider: "claude", action }) });

  const responses = [
    await oauthActionRoute.GET(
      new Request("http://localhost/api/oauth/claude/authorize"),
      params("authorize")
    ),
    await oauthActionRoute.POST(
      jsonRequest("http://localhost/api/oauth/claude/exchange", "POST", {
        code: "attacker-code",
        redirectUri: "http://localhost/callback",
        codeVerifier: "verifier",
      }),
      params("exchange")
    ),
    await cursorImportRoute.GET(new Request("http://localhost/api/oauth/cursor/import")),
    await cursorImportRoute.POST(
      jsonRequest("http://localhost/api/oauth/cursor/import", "POST", {
        accessToken: "token",
        machineId: "machine",
      })
    ),
    await kiroImportRoute.POST(
      jsonRequest("http://localhost/api/oauth/kiro/import", "POST", { refreshToken: "token" })
    ),
    await kiroSocialAuthorizeRoute.GET(
      new Request("http://localhost/api/oauth/kiro/social-authorize?provider=google")
    ),
    await kiroSocialExchangeRoute.POST(
      jsonRequest("http://localhost/api/oauth/kiro/social-exchange", "POST", {
        code: "code",
        codeVerifier: "verifier",
        provider: "google",
      })
    ),
  ];

  for (const response of responses) {
    assert.equal(response.status, 401);
  }
  assert.equal((await providersDb.getProviderConnections()).length, 0);
});

test("OAuth management routes stay reachable while no password is configured", async () => {
  const response = await kiroSocialAuthorizeRoute.GET(
    new Request("http://localhost/api/oauth/kiro/social-authorize?provider=google")
  );
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).authUrl, "string");
});

test("DELETE /api/monitoring/health needs authentication, GET stays public", async () => {
  process.env.INITIAL_PASSWORD = "bootstrap-password";

  const reset = await healthRoute.DELETE(
    new Request("http://localhost/api/monitoring/health", { method: "DELETE" })
  );
  assert.equal(reset.status, 401);

  const probe = await healthRoute.GET();
  assert.equal(probe.status, 200);

  delete process.env.INITIAL_PASSWORD;
  const allowed = await healthRoute.DELETE(
    new Request("http://localhost/api/monitoring/health", { method: "DELETE" })
  );
  assert.equal(allowed.status, 200);
});
