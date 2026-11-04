import test from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../src/lib/system/updateCheck.ts");

function fakeFetch(payload, { status = 200 } = {}) {
  let calls = 0;
  const impl = async () => {
    calls += 1;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { impl, calls: () => calls };
}

test("isNewerVersion compares semver including v prefix and prereleases", () => {
  assert.equal(mod.isNewerVersion("v0.1.1", "0.1.0"), true);
  assert.equal(mod.isNewerVersion("0.2.0", "0.10.0"), false);
  assert.equal(mod.isNewerVersion("1.0.0", "0.99.99"), true);
  assert.equal(mod.isNewerVersion("0.1.0", "0.1.0"), false);
  assert.equal(mod.isNewerVersion("0.1.1", "0.1.1-beta.1"), true);
  assert.equal(mod.isNewerVersion("0.1.1-beta.1", "0.1.1"), false);
  assert.equal(mod.isNewerVersion(null, "0.1.0"), false);
  assert.equal(mod.isNewerVersion("garbage", "0.1.0"), false);
});

test("update check is skipped entirely when COOLROUTER_DISABLE_UPDATE_CHECK=1", async () => {
  mod.resetUpdateCheckCache();
  const f = fakeFetch({ tag_name: "v99.0.0" });
  const status = await mod.getUpdateStatus({
    env: { COOLROUTER_DISABLE_UPDATE_CHECK: "1" },
    fetchImpl: f.impl,
  });
  assert.equal(status.checkDisabled, true);
  assert.equal(status.updateAvailable, false);
  assert.equal(f.calls(), 0);
});

test("update check reports a newer GitHub release and caches it", async () => {
  mod.resetUpdateCheckCache();
  const f = fakeFetch({
    tag_name: "v99.0.0",
    name: "Cool Router v99.0.0",
    html_url: "https://github.com/cyberromeo/coolrouter/releases/tag/v99.0.0",
    published_at: "2026-11-05T00:00:00Z",
  });
  const env = { COOLROUTER_INSTALL_KIND: "docker" };
  const first = await mod.getUpdateStatus({ env, fetchImpl: f.impl });
  assert.equal(first.latest, "99.0.0");
  assert.equal(first.updateAvailable, true);
  assert.equal(first.install, "docker");
  assert.match(first.upgradeCommand, /docker pull ghcr\.io\/cyberromeo\/cool-router:latest/);
  assert.equal(first.release.url, "https://github.com/cyberromeo/coolrouter/releases/tag/v99.0.0");
  await mod.getUpdateStatus({ env, fetchImpl: f.impl });
  assert.equal(f.calls(), 1, "second call should be served from cache");
  await mod.getUpdateStatus({ env, fetchImpl: f.impl, force: true });
  assert.equal(f.calls(), 2, "force re-checks");
});

test("update check fails silently when offline", async () => {
  mod.resetUpdateCheckCache();
  const status = await mod.getUpdateStatus({
    env: { COOLROUTER_INSTALL_KIND: "source" },
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
  });
  assert.equal(status.latest, null);
  assert.equal(status.updateAvailable, false);
  assert.match(status.error, /ENOTFOUND/);
  assert.equal(status.upgradeCommand, "git pull && npm install && npm run build");
});

test("desktop installs carry no shell upgrade command", () => {
  assert.equal(mod.detectInstallKind({ COOLROUTER_INSTALL_KIND: "desktop" }), "desktop");
  assert.equal(mod.getUpgradeCommand("desktop"), null);
});
