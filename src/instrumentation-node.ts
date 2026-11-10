/**
 * Node.js-only instrumentation logic.
 *
 * Separated from instrumentation.ts so that Turbopack's Edge bundler
 * does not trace into Node.js-only modules (fs, path, os, better-sqlite3, etc.)
 * and emit spurious "not supported in Edge Runtime" warnings.
 */

function getRandomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isBackgroundServicesDisabled(): boolean {
  const raw = process.env.COOLROUTER_DISABLE_BACKGROUND_SERVICES;
  if (!raw) return false;
  return new Set(["1", "true", "yes", "on"]).has(raw.trim().toLowerCase());
}

async function ensureSecrets(): Promise<void> {
  let getPersistedSecret = (_key: string): string | null => null;
  let persistSecret = (_key: string, _value: string): void => {};

  try {
    ({ getPersistedSecret, persistSecret } = await import("@/lib/db/secrets"));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[STARTUP] Secret persistence unavailable; falling back to process-local secrets:",
      msg
    );
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === "") {
    const persisted = getPersistedSecret("jwtSecret");
    if (persisted) {
      process.env.JWT_SECRET = persisted;
      console.log("[STARTUP] JWT_SECRET restored from persistent store");
    } else {
      const generated = toBase64(getRandomBytes(48));
      process.env.JWT_SECRET = generated;
      persistSecret("jwtSecret", generated);
      console.log("[STARTUP] JWT_SECRET auto-generated and persisted (random 64-char secret)");
    }
  }

  if (!process.env.API_KEY_SECRET || process.env.API_KEY_SECRET.trim() === "") {
    const persisted = getPersistedSecret("apiKeySecret");
    if (persisted) {
      process.env.API_KEY_SECRET = persisted;
    } else {
      const generated = toHex(getRandomBytes(32));
      process.env.API_KEY_SECRET = generated;
      persistSecret("apiKeySecret", generated);
      console.log(
        "[STARTUP] API_KEY_SECRET auto-generated and persisted (random 64-char hex secret)"
      );
    }
  }
}

/**
 * Desktop app only: the Electron shell starts this server as a child process and passes
 * its own PID. If the shell disappears without stopping us (crash, force-close, an
 * installer killing the app) nothing else would — the orphan keeps the port, and on
 * Windows keeps the install folder locked so the next update fails. Poll the parent and
 * exit when it is gone.
 */
function watchParentProcess(): void {
  const parentPid = Number.parseInt(process.env.COOLROUTER_PARENT_PID || "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 1) return;

  const timer = setInterval(() => {
    try {
      // Signal 0 only tests for existence. EPERM still means "alive".
      process.kill(parentPid, 0);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ESRCH") {
        console.log(`[STARTUP] Desktop shell (pid ${parentPid}) is gone — shutting down.`);
        process.exit(0);
      }
    }
  }, 1000);
  timer.unref();

  // The shell also keeps our stdin pipe open and closes it to ask for a clean stop.
  // Windows has no SIGTERM — child.kill() there ends the process on the spot, skipping
  // the request drain and the SQLite checkpoint — so this is the graceful path on every
  // platform. The pipe also closes by itself the instant the shell dies.
  if (process.env.COOLROUTER_PARENT_STDIN === "1") {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      console.log("[STARTUP] Desktop shell asked the server to stop.");
      import("@/lib/gracefulShutdown")
        .then(({ requestProcessShutdown }) => requestProcessShutdown())
        .catch(() => process.exit(0));
    };
    process.stdin.on("end", stop);
    process.stdin.on("close", stop);
    process.stdin.on("error", () => {});
    process.stdin.resume();
  }
}

export async function registerNodejs(): Promise<void> {
  watchParentProcess();

  // Initialize proxy fetch patch FIRST (before any HTTP requests)
  await import("@coolrouter/open-sse/index.ts");
  console.log("[STARTUP] Global fetch proxy patch initialized");

  await ensureSecrets();

  // Trigger request-log layout migration during startup, before any request hits usageDb.
  await import("@/lib/usage/migrations");

  const { initConsoleInterceptor } = await import("@/lib/consoleInterceptor");
  initConsoleInterceptor();

  const [
    { initGracefulShutdown },
    { initApiBridgeServer },
    { startBackgroundRefresh },
    { startProviderLimitsSyncScheduler },
    { getSettings },
  ] = await Promise.all([
    import("@/lib/gracefulShutdown"),
    import("@/lib/apiBridgeServer"),
    import("@/domain/quotaCache"),
    import("@/shared/services/providerLimitsSyncScheduler"),
    import("@/lib/db/settings"),
  ]);

  initGracefulShutdown();
  initApiBridgeServer();
  if (!isBackgroundServicesDisabled()) {
    startBackgroundRefresh();
    console.log("[STARTUP] Quota cache background refresh started");
    startProviderLimitsSyncScheduler();
    console.log("[STARTUP] Provider limits sync scheduler started");
  }

  try {
    const [{ setCustomAliases }, { setDefaultFastServiceTierEnabled }] = await Promise.all([
      import("@coolrouter/open-sse/services/modelDeprecation.ts"),
      import("@coolrouter/open-sse/executors/codex.ts"),
    ]);
    const settings = await getSettings();

    if (settings.modelAliases) {
      const aliases =
        typeof settings.modelAliases === "string"
          ? JSON.parse(settings.modelAliases)
          : settings.modelAliases;
      if (aliases && typeof aliases === "object") {
        setCustomAliases(aliases);
        console.log(
          `[STARTUP] Restored ${Object.keys(aliases).length} custom model alias(es) from settings`
        );
      }
    }

    const persisted =
      typeof settings.codexServiceTier === "string"
        ? JSON.parse(settings.codexServiceTier)
        : settings.codexServiceTier;

    if (typeof persisted?.enabled === "boolean") {
      setDefaultFastServiceTierEnabled(persisted.enabled);
      console.log(
        `[STARTUP] Restored Codex fast service tier: ${persisted.enabled ? "on" : "off"}`
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[STARTUP] Could not restore runtime settings:", msg);
  }

  try {
    const { initAuditLog, cleanupExpiredLogs } = await import("@/lib/compliance/index");
    initAuditLog();
    console.log("[COMPLIANCE] Audit log table initialized");

    const cleanup = cleanupExpiredLogs();
    if (
      cleanup.deletedUsage ||
      cleanup.deletedCallLogs ||
      cleanup.deletedProxyLogs ||
      cleanup.deletedRequestDetailLogs ||
      cleanup.deletedAuditLogs ||
      cleanup.deletedMcpAuditLogs
    ) {
      console.log("[COMPLIANCE] Expired log cleanup:", cleanup);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[COMPLIANCE] Could not initialize audit log:", msg);
  }
}
