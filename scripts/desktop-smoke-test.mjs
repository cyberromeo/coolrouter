#!/usr/bin/env node
/**
 * Desktop smoke test — launch the packaged app (electron-builder's unpacked output) and
 * check the things a user hits in the first minute:
 *
 *   1. the app starts and its bundled server answers
 *   2. first-run state is reported, a password can be created, and creating it signs
 *      the caller in (the session cookie works on a protected route)
 *   3. protected routes reject callers without the cookie; the LLM surface stays open
 *   4. when the app is killed, the server shuts itself down instead of lingering
 *
 * Usage:  node scripts/desktop-smoke-test.mjs [path-to-executable]
 * Runs against a throwaway data folder; never touches a real install.
 * On Linux run it under a display:  xvfb-run -a node scripts/desktop-smoke-test.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "electron", "dist-electron");
const PORT = Number(process.env.SMOKE_PORT || 20128);
const BASE = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
// Throwaway credential for the throwaway data folder.
const TEST_PASSWORD = `smoke-${Date.now().toString(36)}`;

function findExecutable() {
  if (process.argv[2]) return path.resolve(process.argv[2]);

  if (process.platform === "win32") {
    return path.join(DIST, "win-unpacked", "Cool Router.exe");
  }
  if (process.platform === "darwin") {
    for (const dir of ["mac-arm64", "mac", "mac-universal"]) {
      const candidate = path.join(DIST, dir, "Cool Router.app", "Contents", "MacOS", "Cool Router");
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(DIST, "mac", "Cool Router.app", "Contents", "MacOS", "Cool Router");
  }
  const unpacked = path.join(DIST, "linux-unpacked");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "package.json"), "utf8"));
  for (const name of [pkg.build?.linux?.executableName, pkg.name, "cool-router"]) {
    if (name && fs.existsSync(path.join(unpacked, name))) return path.join(unpacked, name);
  }
  return path.join(unpacked, pkg.name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function isServerUp() {
  try {
    const res = await fetch(`${BASE}/api/monitoring/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

async function main() {
  const executable = findExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(
      `Packaged app not found at ${executable}. Build it first (electron-builder --dir).`
    );
  }
  if (await isServerUp()) {
    throw new Error(
      `Something already answers on ${BASE}. Stop it first (is Cool Router running?).`
    );
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-smoke-"));
  // Its own browser profile too: keeps this run's cookies and single-instance lock away
  // from a real Cool Router install on the same machine.
  const args = [`--user-data-dir=${path.join(dataDir, "profile")}`];
  if (process.platform === "linux") args.push("--no-sandbox");
  console.log(`Launching ${executable}`);
  console.log(`Data folder: ${dataDir}`);

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    COOLROUTER_DISABLE_UPDATE_CHECK: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  };
  // A stray PORT (CI images set one sometimes) would move the server away from where
  // this test looks for it.
  env.PORT = String(PORT);
  delete env.INITIAL_PASSWORD;

  const app = spawn(executable, args, { env, stdio: ["ignore", "inherit", "inherit"] });
  let appExit = null;
  app.on("exit", (code, signal) => {
    appExit = { code, signal };
  });
  app.on("error", (error) => {
    appExit = { code: null, signal: null, error };
  });

  let failure = null;
  try {
    // 1 ── the app starts and the server answers
    const started = Date.now();
    let up = false;
    while (Date.now() - started < START_TIMEOUT_MS) {
      if (appExit) {
        throw new Error(
          `The app exited during startup (${appExit.error?.message || `code ${appExit.code}, signal ${appExit.signal}`}).`
        );
      }
      if (await isServerUp()) {
        up = true;
        break;
      }
      await sleep(1000);
    }
    assert(up, `server answered within ${Math.round((Date.now() - started) / 1000)}s`);

    // 2 ── first run → create a password → signed in
    const fresh = await request("/api/settings/require-login");
    assert(fresh.status === 200 && fresh.json, "first-run state endpoint answers with JSON");
    assert(fresh.json.hasPassword === false, "fresh install has no password");
    assert(fresh.json.setupComplete === false, "fresh install is not set up yet");

    const login = await request("/login");
    assert(login.status === 200 && /<html/i.test(login.text), "sign-in page renders");

    const tooShort = await request("/api/settings/require-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireLogin: true, password: "abc" }),
    });
    assert(tooShort.status === 400, "a too-short password is rejected with 400");

    const created = await request("/api/settings/require-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireLogin: true, password: TEST_PASSWORD }),
    });
    const setCookie = created.headers.get("set-cookie") || "";
    const cookie = setCookie.split(";")[0];
    assert(created.status === 200, "password is created");
    assert(/^auth_token=.+/.test(cookie), "creating the password issues a session cookie");
    assert(/max-age=\d+/i.test(setCookie), "the session cookie is persistent");

    const finish = await request("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ setupComplete: true }),
    });
    assert(finish.status === 200, "the wizard can finish setup with that session");

    const dashboard = await request("/dashboard", { headers: { cookie } });
    assert(dashboard.status === 200, "dashboard opens for the signed-in session");

    // 3 ── auth gate
    const anonymous = await request("/api/settings");
    assert(anonymous.status === 401, "management API rejects callers without a session");

    const anonymousDashboard = await request("/dashboard");
    assert(
      anonymousDashboard.status >= 300 && anonymousDashboard.status < 400,
      "dashboard redirects signed-out visitors to sign-in"
    );

    const hijack = await request("/api/settings/require-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireLogin: true, password: "someone-else" }),
    });
    assert(hijack.status === 401, "the password cannot be replaced without signing in");

    const wrong = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "not-the-password" }),
    });
    assert(wrong.status === 401, "a wrong password is rejected");

    const right = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    assert(
      right.status === 200 && /^auth_token=.+/.test(right.headers.get("set-cookie") || ""),
      "the right password signs in"
    );

    const models = await request("/v1/models");
    assert(models.status === 200 && models.json, "OpenAI-compatible /v1/models answers");

    const gemini = await request("/v1beta/models");
    assert(gemini.status === 200 && gemini.json, "Gemini-compatible /v1beta/models answers");

    // 4 ── kill the app; the server must not linger
    console.log("Killing the app process…");
    app.kill("SIGKILL");
    const killedAt = Date.now();
    let down = false;
    while (Date.now() - killedAt < SHUTDOWN_TIMEOUT_MS) {
      await sleep(1000);
      if (!(await isServerUp())) {
        down = true;
        break;
      }
    }
    assert(
      down,
      `server shut itself down ${Math.round((Date.now() - killedAt) / 1000)}s after the app was killed`
    );
  } catch (error) {
    failure = error;
  } finally {
    if (!appExit) {
      try {
        app.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    if (failure) {
      console.error(`\n✗ ${failure.message}`);
      const logFile = path.join(dataDir, "app-logs", "desktop.log");
      if (fs.existsSync(logFile)) {
        const tail = fs.readFileSync(logFile, "utf8").split(/\r?\n/).slice(-80).join("\n");
        console.error(`\n── last lines of ${logFile} ──\n${tail}`);
      } else {
        console.error(`(no desktop log at ${logFile})`);
      }
    }
    await sleep(1500); // let file handles close before removing the folder (Windows)
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      /* leave it for the OS temp cleaner */
    }
  }

  if (failure) process.exit(1);
  console.log("\nDesktop smoke test passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
