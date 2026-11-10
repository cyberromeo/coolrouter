import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-login-bootstrap-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const route = await import("../../src/app/api/settings/require-login/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

test.beforeEach(async () => {
  delete process.env.INITIAL_PASSWORD;
  delete process.env.JWT_SECRET;
  await resetStorage();
});

test.afterEach(() => {
  bcrypt.hash = originalHash;
});

test.after(() => {
  delete process.env.INITIAL_PASSWORD;
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const originalHash = bcrypt.hash;

test("public login bootstrap route exposes the metadata the login page consumes", async () => {
  await settingsDb.updateSettings({
    requireLogin: true,
    setupComplete: true,
  });

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    requireLogin: true,
    hasPassword: false,
    setupComplete: true,
    initialPasswordActive: false,
    nodeVersion: body.nodeVersion,
    nodeCompatible: body.nodeCompatible,
  });
});

test("public login bootstrap route reports env-provided bootstrap password metadata", async () => {
  process.env.INITIAL_PASSWORD = "bootstrap-secret";

  await settingsDb.updateSettings({
    requireLogin: true,
    setupComplete: true,
  });

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    requireLogin: true,
    hasPassword: true,
    setupComplete: true,
    initialPasswordActive: true,
    nodeVersion: body.nodeVersion,
    nodeCompatible: body.nodeCompatible,
  });
});

test("public login bootstrap route reports stored password metadata and disabled auth state", async () => {
  await settingsDb.updateSettings({
    requireLogin: false,
    password: "hashed-password",
    setupComplete: true,
  });

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    requireLogin: false,
    hasPassword: true,
    setupComplete: true,
    initialPasswordActive: false,
    nodeVersion: body.nodeVersion,
    nodeCompatible: body.nodeCompatible,
  });
});

test("public login bootstrap route POST rejects invalid JSON bodies", async () => {
  const request = new Request("http://localhost/api/settings/require-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ invalid json",
  });

  const response = await route.POST(request);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.message, "Invalid request");
  assert.deepEqual(body.error.details, [{ field: "body", message: "Invalid JSON body" }]);
});

test("public login bootstrap route POST rejects empty updates", async () => {
  const request = new Request("http://localhost/api/settings/require-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  const response = await route.POST(request);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.message, "Invalid request");
  assert.match(body.error.details[0].message, /No valid fields to update/);
});

test("public login bootstrap route POST updates requireLogin without forcing password", async () => {
  const request = new Request("http://localhost/api/settings/require-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requireLogin: false }),
  });

  const response = await route.POST(request);
  const body = await response.json();
  const settings = await settingsDb.getSettings();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true });
  assert.equal(settings.requireLogin, false);
  assert.equal(settings.password, undefined);
});

test("public login bootstrap route POST hashes and stores passwords", async () => {
  const password = "super-secret";
  const request = new Request("http://localhost/api/settings/require-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requireLogin: true, password }),
  });

  const response = await route.POST(request);
  const body = await response.json();
  const settings = await settingsDb.getSettings();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true });
  assert.equal(settings.requireLogin, true);
  assert.ok(settings.password);
  assert.notEqual(settings.password, password);
  assert.equal(await bcrypt.compare(password, settings.password), true);
});

test("public login bootstrap route POST returns 500 when hashing fails", async () => {
  bcrypt.hash = async () => {
    throw new Error("hash failed");
  };

  const request = new Request("http://localhost/api/settings/require-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "super-secret" }),
  });

  const response = await route.POST(request);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: "hash failed" });
});

// ── First-run sign-in and the "password already exists" guard ───────────────

function postRequest(body, headers = {}) {
  return new Request("http://localhost/api/settings/require-login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function sessionCookieHeader() {
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return { cookie: `auth_token=${token}` };
}

test("setting the first password signs the caller in with a persistent session cookie", async () => {
  process.env.JWT_SECRET = "jwt-secret-for-tests";

  const response = await route.POST(postRequest({ requireLogin: true, password: "first-pass" }));
  const setCookie = response.headers.get("set-cookie") || "";

  assert.equal(response.status, 200);
  assert.match(setCookie, /^auth_token=[^;]+/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Max-Age=2592000/i);
  assert.match(setCookie, /SameSite=lax/i);
});

test("turning login off without a password does not issue a session cookie", async () => {
  process.env.JWT_SECRET = "jwt-secret-for-tests";

  const response = await route.POST(postRequest({ requireLogin: false }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a password alone turns requireLogin on", async () => {
  await settingsDb.updateSettings({ requireLogin: false });

  const response = await route.POST(postRequest({ password: "first-pass" }));
  const settings = await settingsDb.getSettings();

  assert.equal(response.status, 200);
  assert.equal(settings.requireLogin, true);
});

test("once a password exists, unauthenticated callers cannot change anything", async () => {
  process.env.JWT_SECRET = "jwt-secret-for-tests";
  const storedHash = await originalHash("original-pass", 4);
  await settingsDb.updateSettings({ requireLogin: true, password: storedHash });

  const takeover = await route.POST(postRequest({ requireLogin: true, password: "attacker" }));
  const disable = await route.POST(postRequest({ requireLogin: false }));
  const settings = await settingsDb.getSettings();

  assert.equal(takeover.status, 401);
  assert.equal(disable.status, 401);
  assert.equal(settings.password, storedHash);
  assert.equal(settings.requireLogin, true);
});

test("an env INITIAL_PASSWORD counts as an existing password", async () => {
  process.env.JWT_SECRET = "jwt-secret-for-tests";
  process.env.INITIAL_PASSWORD = "bootstrap-secret";

  const response = await route.POST(postRequest({ requireLogin: true, password: "attacker" }));
  const settings = await settingsDb.getSettings();

  assert.equal(response.status, 401);
  assert.equal(settings.password, undefined);
});

test("a signed-in caller can toggle requireLogin but not replace the password here", async () => {
  process.env.JWT_SECRET = "jwt-secret-for-tests";
  const storedHash = await originalHash("original-pass", 4);
  await settingsDb.updateSettings({ requireLogin: true, password: storedHash });
  const headers = await sessionCookieHeader();

  const replace = await route.POST(postRequest({ password: "new-pass-1" }, headers));
  assert.equal(replace.status, 409);
  assert.equal((await settingsDb.getSettings()).password, storedHash);

  const toggle = await route.POST(postRequest({ requireLogin: false }, headers));
  assert.equal(toggle.status, 200);
  assert.equal((await settingsDb.getSettings()).requireLogin, false);
});

test("a session cookie signed with another secret is rejected", async () => {
  process.env.JWT_SECRET = "jwt-secret-for-tests";
  await settingsDb.updateSettings({
    requireLogin: true,
    password: await originalHash("original-pass", 4),
  });
  const forged = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("some-other-secret"));

  const response = await route.POST(
    postRequest({ requireLogin: false }, { cookie: `auth_token=${forged}` })
  );

  assert.equal(response.status, 401);
  assert.equal((await settingsDb.getSettings()).requireLogin, true);
});
