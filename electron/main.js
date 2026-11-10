/**
 * Cool Router Desktop App - Main Process
 *
 * Owns the window, tray, application menu, auto-updates and the lifecycle of the
 * bundled Next.js server (run with the Node.js runtime shipped in resources/node).
 *
 * Startup order matters for how the app feels:
 *   1. The window opens straight away on a local splash page (splash.html).
 *   2. The server is started in the background and polled until it answers.
 *   3. The window navigates to the dashboard — or the splash page turns into an error
 *      screen with "Try again" / "Open logs" instead of leaving a blank window.
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  session,
  Notification,
  dialog,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const tcp = require("net");
const { spawn, spawnSync } = require("child_process");
const { autoUpdater } = require("electron-updater");

// ── Single Instance Lock ───────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// ── Environment Detection ──────────────────────────────────
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

// ── Paths ──────────────────────────────────────────────────
const APP_PATH = app.getAppPath();
const RESOURCES_PATH = !isDev ? process.resourcesPath : APP_PATH;
const NEXT_SERVER_PATH = path.join(RESOURCES_PATH, "app");
const SPLASH_PAGE = path.join(__dirname, "splash.html");
const DOCS_URL = "https://github.com/cyberromeo/coolrouter#readme";

const DEFAULT_PORT = 20128;
const PORT_CHOICES = [20128, 20129, 3000, 8080];
// First launch runs database migrations (and, on Windows, a virus scan of every bundled
// file), so give the server real time before calling it a failure.
const SERVER_START_TIMEOUT_MS = 120_000;
const MAX_AUTO_RESTARTS = 3;
const AUTO_RESTART_WINDOW_MS = 5 * 60 * 1000;

// Windows shows this id (not "electron.app.Cool Router") on notifications and taskbar groups.
if (isWindows) app.setAppUserModelId("com.cyberromeo.coolrouter");

// ── State ──────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let nextServer = null;
let serverPort = DEFAULT_PORT;
let allowLanAccess = false;
let serverState = { status: "starting", port: serverPort, error: null };
let startInFlight = null; // de-duplicates concurrent start requests
let restartHistory = [];
let loopbackBridge = null;
let dataDir = null;
let logStream = null;
let desktopConfig = {};
const recentLogLines = [];

const getServerUrl = () => `http://localhost:${serverPort}`;

app.on("second-instance", () => showMainWindow());

// ── Data directory ─────────────────────────────────────────
// Mirrors src/lib/dataPaths.ts and scripts/bootstrap-env.mjs.
function resolveDataDir(overridePath, env = process.env) {
  if (overridePath && overridePath.trim()) return path.resolve(overridePath);

  const configured = env.DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  if (isWindows) {
    const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "coolrouter");
  }

  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(path.resolve(xdg), "coolrouter");

  return path.join(os.homedir(), ".coolrouter");
}

function getPreferredEnvFilePath(env = process.env) {
  const candidates = [];

  if (env.DATA_DIR?.trim()) {
    candidates.push(path.join(path.resolve(env.DATA_DIR.trim()), ".env"));
  }

  candidates.push(path.join(resolveDataDir(null, env), ".env"));
  candidates.push(path.join(process.cwd(), ".env"));

  return candidates.find((filePath) => fs.existsSync(filePath)) || null;
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

// ── Logging ────────────────────────────────────────────────
// A packaged GUI app has no console, so everything also goes to
// <data>/app-logs/desktop.log. Not <data>/logs: the server treats that folder as a legacy
// request-log directory and archives and deletes it on startup.
function getLogDir() {
  return path.join(dataDir || resolveDataDir(null), "app-logs");
}

function getLogFile() {
  return path.join(getLogDir(), "desktop.log");
}

function initLogging() {
  try {
    fs.mkdirSync(getLogDir(), { recursive: true });
    const file = getLogFile();
    // Keep one previous file; a runaway log should never fill the disk.
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
      fs.renameSync(file, `${file}.1`);
    }
    logStream = fs.createWriteStream(file, { flags: "a" });
    logStream.on("error", () => {
      logStream = null;
    });
  } catch {
    logStream = null;
  }
}

function writeLog(level, parts) {
  const text = parts
    .map((part) =>
      part instanceof Error
        ? part.stack || part.message
        : typeof part === "string"
          ? part
          : safeJson(part)
    )
    .join(" ");
  const line = `${new Date().toISOString()} [${level}] ${text}`;
  recentLogLines.push(line);
  if (recentLogLines.length > 200) recentLogLines.shift();
  try {
    logStream?.write(`${line}\n`);
  } catch {
    /* disk full or stream closed — never let logging take the app down */
  }
  try {
    (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
  } catch {
    /* no console attached */
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const log = {
  info: (...parts) => writeLog("info", parts),
  warn: (...parts) => writeLog("warn", parts),
  error: (...parts) => writeLog("error", parts),
};

// ── Desktop settings (<data>/desktop.json) ─────────────────
function getDesktopConfigPath() {
  return path.join(dataDir || resolveDataDir(null), "desktop.json");
}

function loadDesktopConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getDesktopConfigPath(), "utf8"));
    desktopConfig = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    desktopConfig = {};
  }
}

function saveDesktopConfig(patch) {
  desktopConfig = { ...desktopConfig, ...patch };
  try {
    fs.mkdirSync(path.dirname(getDesktopConfigPath()), { recursive: true });
    fs.writeFileSync(getDesktopConfigPath(), `${JSON.stringify(desktopConfig, null, 2)}\n`, "utf8");
  } catch (error) {
    log.warn("Could not save desktop settings:", error.message);
  }
}

function parsePort(value) {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

// ── Node runtime for the server ────────────────────────────
function resolveNodeExecutable(env = process.env) {
  // Prefer the Node.js runtime bundled with the installer (resources/node), so
  // users don't need Node installed and native modules match its ABI.
  const bundledNode = process.resourcesPath
    ? path.join(process.resourcesPath, "node", isWindows ? "node.exe" : "node")
    : null;
  const candidates = [
    env.COOLROUTER_NODE_PATH,
    bundledNode,
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/opt/local/bin/node",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* continue */
    }
  }

  return "node";
}

/**
 * Does the existing database hold credentials encrypted with a key we no longer have?
 * Returns true / false, or null when it cannot be determined.
 *
 * better-sqlite3 is compiled for the bundled Node.js runtime, not for Electron, so it
 * cannot be loaded in this process — ask the bundled runtime instead.
 */
function hasEncryptedCredentials(dbPath, nodeExecutable) {
  if (!fs.existsSync(dbPath)) return false;

  const script = `
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
    let found = false;
    try {
      found = !!db
        .prepare(
          "SELECT 1 FROM provider_connections WHERE access_token LIKE 'enc:v1:%' OR refresh_token LIKE 'enc:v1:%' OR api_key LIKE 'enc:v1:%' OR id_token LIKE 'enc:v1:%' LIMIT 1"
        )
        .get();
    } catch (error) {
      if (!/no such table/i.test(String(error && error.message))) throw error;
    } finally {
      db.close();
    }
    process.stdout.write(found ? "encrypted" : "plain");
  `;

  try {
    const result = spawnSync(nodeExecutable, ["-e", script, dbPath], {
      cwd: NEXT_SERVER_PATH,
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
    if (result.status === 0) return result.stdout.trim() === "encrypted";
    log.warn("Could not inspect the database:", (result.stderr || "").trim().slice(0, 500));
  } catch (error) {
    log.warn("Could not inspect the database:", error.message);
  }
  return null;
}

/**
 * Zero-config bootstrap. Electron's main process is CommonJS and cannot import
 * scripts/bootstrap-env.mjs, so this mirrors it:
 *   1. read secrets persisted in <data>/server.env
 *   2. generate the missing ones
 *   3. persist them for the next launch
 * Returns the environment for the server process, or null when startup must not go on.
 */
async function prepareServerEnvironment() {
  const preferredEnvPath = getPreferredEnvFilePath(process.env);
  const preferredEnv = parseEnvFile(preferredEnvPath);
  const serverEnvPath = path.join(dataDir, "server.env");
  const persisted = parseEnvFile(serverEnvPath);
  const serverEnv = { ...persisted, ...preferredEnv, ...process.env };
  const nodeExecutable = resolveNodeExecutable(serverEnv);
  let changed = false;

  if (!serverEnv.JWT_SECRET) {
    serverEnv.JWT_SECRET = persisted.JWT_SECRET = crypto.randomBytes(64).toString("hex");
    changed = true;
    log.info("JWT_SECRET generated");
  }

  if (!serverEnv.STORAGE_ENCRYPTION_KEY) {
    const dbPath = path.join(dataDir, "storage.sqlite");
    const encrypted = hasEncryptedCredentials(dbPath, nodeExecutable);
    if (encrypted !== false) {
      // The key that encrypted the saved provider logins is gone (server.env deleted or
      // the data folder copied without it). A new key cannot read them — let the user
      // decide instead of failing silently or quietly orphaning their credentials.
      log.error(`STORAGE_ENCRYPTION_KEY is missing but ${dbPath} already holds data.`);
      const choice = await dialog.showMessageBox({
        type: "warning",
        title: "Cool Router",
        message: "The encryption key for your saved provider logins is missing.",
        detail:
          `Cool Router found existing data in:\n${dataDir}\n\n` +
          "but not the key that encrypts provider credentials (server.env). " +
          "Restore server.env from a backup to keep them, or continue with a new key — " +
          "your settings, combos and usage history stay, but providers must be connected again.",
        buttons: ["Quit", "Open data folder", "Continue with a new key"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response !== 2) {
        if (choice.response === 1) await shell.openPath(dataDir);
        return null;
      }
    }
    serverEnv.STORAGE_ENCRYPTION_KEY = persisted.STORAGE_ENCRYPTION_KEY = crypto
      .randomBytes(32)
      .toString("hex");
    serverEnv.STORAGE_ENCRYPTION_KEY_VERSION = persisted.STORAGE_ENCRYPTION_KEY_VERSION = "v1";
    changed = true;
    log.info("STORAGE_ENCRYPTION_KEY generated");
  }

  if (!serverEnv.API_KEY_SECRET) {
    serverEnv.API_KEY_SECRET = persisted.API_KEY_SECRET = crypto.randomBytes(32).toString("hex");
    changed = true;
    log.info("API_KEY_SECRET generated");
  }

  if (changed) {
    serverEnv.COOLROUTER_BOOTSTRAPPED = "true";
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const lines = [
        "# Auto-generated by Cool Router — do not delete (it holds your encryption keys)",
        "",
        ...Object.entries(persisted).map(([k, v]) => `${k}=${v}`),
        "",
      ];
      fs.writeFileSync(serverEnvPath, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
      log.info("Secrets saved to", serverEnvPath);
    } catch (error) {
      log.warn("Could not save secrets:", error.message);
    }
  }

  return { serverEnv, nodeExecutable };
}

// ── Port helpers ───────────────────────────────────────────
function canBind(port, host) {
  return new Promise((resolve) => {
    const probe = tcp.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

/**
 * Is the port free for the server? Probes both the loopback and the wildcard address:
 * Windows lets a socket bind 127.0.0.1 while another program holds 0.0.0.0 on the same
 * port (and the other way round), so a single probe can miss a listener.
 */
async function isPortFree(port) {
  return (await canBind(port, "127.0.0.1")) && (await canBind(port, "0.0.0.0"));
}

/** PID of the process listening on a TCP port, or null. */
function findListenerPid(port) {
  try {
    if (isWindows) {
      const out = spawnSync("netstat", ["-ano", "-p", "TCP"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      }).stdout;
      for (const line of String(out || "").split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // Proto  Local Address  Foreign Address  State  PID
        // The State column is translated on non-English Windows, so recognise a listening
        // socket by its foreign address instead: only listeners have remote port 0
        // (shown as 0.0.0.0:0, [::]:0 or, for a loopback listener, 127.0.0.1:0).
        if (
          cols.length >= 5 &&
          cols[0] === "TCP" &&
          cols[1].endsWith(`:${port}`) &&
          cols[2].endsWith(":0")
        ) {
          return parsePidValue(cols[cols.length - 1]);
        }
      }
      return null;
    }
    const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      timeout: 10_000,
    }).stdout;
    return parsePidValue(String(out || "").split(/\r?\n/)[0]);
  } catch {
    return null;
  }
}

function parsePidValue(value) {
  const pid = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Full path of a process's executable, or null. */
function getProcessPath(pid) {
  try {
    if (isWindows) {
      const out = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).Path`],
        { encoding: "utf8", windowsHide: true, timeout: 15_000 }
      ).stdout;
      return String(out || "").trim() || null;
    }
    if (isLinux) return fs.readlinkSync(`/proc/${pid}/exe`);
    const out = spawnSync("ps", ["-o", "comm=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 10_000,
    }).stdout;
    return String(out || "").trim() || null;
  } catch {
    return null;
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  const left = path.resolve(a);
  const right = path.resolve(b);
  return isWindows || isMac ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A server left behind by a previous run (the app was force-closed, crashed, or was
 * replaced by an installer while running) still holds the port. If the listener is our
 * own bundled Node.js runtime, stop it so this launch starts a fresh server.
 */
async function reclaimPortFromStaleServer(port, nodeExecutable) {
  const pid = findListenerPid(port);
  if (!pid || pid === process.pid) return false;
  if (!samePath(getProcessPath(pid), nodeExecutable)) return false;

  log.warn(`Port ${port} is held by a leftover Cool Router server (pid ${pid}) — stopping it.`);
  try {
    process.kill(pid);
  } catch (error) {
    log.warn("Could not stop the leftover server:", error.message);
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if (await isPortFree(port)) return true;
  }
  return false;
}

async function pickAvailablePort(preferred, nodeExecutable) {
  if (await isPortFree(preferred)) return preferred;
  if (await reclaimPortFromStaleServer(preferred, nodeExecutable)) return preferred;
  for (let port = preferred + 1; port <= preferred + 20 && port <= 65535; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

/**
 * The server listens on IPv4. "localhost" resolves to ::1 first on many systems, and on
 * Windows a refused connection costs a client a second or more before it falls back to
 * 127.0.0.1. Forward ::1 to the server so both loopback addresses answer immediately.
 */
function startLoopbackBridge(port) {
  stopLoopbackBridge();
  const bridge = tcp.createServer((client) => {
    const upstream = tcp.connect({ port, host: "127.0.0.1" });
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    client.pipe(upstream);
    upstream.pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
  });
  bridge.on("error", (error) => {
    // No IPv6 on this machine, or something else already answers on ::1 — not needed then.
    log.info("IPv6 loopback bridge not started:", error.code || error.message);
    if (loopbackBridge === bridge) loopbackBridge = null;
  });
  bridge.listen({ port, host: "::1", ipv6Only: true, exclusive: true });
  loopbackBridge = bridge;
}

function stopLoopbackBridge() {
  if (!loopbackBridge) return;
  try {
    loopbackBridge.close();
  } catch {
    /* already closed */
  }
  loopbackBridge = null;
}

// ── Auto-Updater Configuration ──────────────────────────────
// Updates come from GitHub Releases (cyberromeo/coolrouter): latest.yml (Windows),
// latest-linux.yml (AppImage). How an update is applied depends on the package:
//   • Windows NSIS + Linux AppImage → electron-updater downloads it, then "Restart to update"
//   • macOS (.dmg, not notarized) + Linux .deb → can't self-install, so we check the GitHub
//     releases API and notify with a link to the release page instead.
const UPDATE_REPO = "cyberromeo/coolrouter";
const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const updateChecksDisabled = ["1", "true", "yes"].includes(
  String(process.env.COOLROUTER_DISABLE_UPDATE_CHECK || "")
    .trim()
    .toLowerCase()
);

function getUpdateStrategy() {
  if (isWindows) return "auto";
  if (isLinux && process.env.APPIMAGE) return "auto";
  return "notify";
}

const updateStrategy = getUpdateStrategy();
let updateState = {
  status: "idle", // idle | checking | available | downloading | downloaded | not-available | error | disabled
  strategy: updateStrategy,
  currentVersion: app.getVersion(),
  version: null,
  percent: null,
  releaseUrl: RELEASES_PAGE_URL,
  message: null,
  checkedAt: null,
};
let notifiedVersion = null;
let updateTimer = null;

autoUpdater.autoDownload = updateStrategy === "auto";
autoUpdater.autoInstallOnAppQuit = updateStrategy === "auto";
autoUpdater.logger = {
  info: (...parts) => log.info("[updater]", ...parts),
  warn: (...parts) => log.warn("[updater]", ...parts),
  error: (...parts) => log.error("[updater]", ...parts),
  debug: () => {},
};

// ── Helper: Send IPC event to renderer ─────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function setServerState(patch) {
  serverState = { ...serverState, port: serverPort, ...patch };
  sendToRenderer("server-status", serverState);
  refreshTray();
}

// ── Helper: Wait for server readiness ──────────────────────
async function waitForServer(url, proc, timeoutMs = SERVER_START_TIMEOUT_MS) {
  const healthUrl = `${url.replace("localhost", "127.0.0.1")}/api/monitoring/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // The process died (bad native module, port race, …): no point waiting out the timer.
    if (proc && (proc.exitCode !== null || proc.signalCode !== null)) return false;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (res.status < 500) return true;
    } catch {
      /* server not ready yet */
    }
    await sleep(400);
  }
  return false;
}

// ── Helper: Wait for server process exit with timeout ──────
async function waitForServerExit(proc, timeoutMs = 5000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  await Promise.race([
    new Promise((r) => proc.once("exit", r)),
    new Promise((r) =>
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        r();
      }, timeoutMs)
    ),
  ]);
}

// ── Auto-Updater ────────────────────────────────────────────
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  sendToRenderer("update-status", updateState);
}

function releaseUrlFor(version) {
  return version
    ? `https://github.com/${UPDATE_REPO}/releases/tag/v${String(version).replace(/^v/, "")}`
    : RELEASES_PAGE_URL;
}

function parseVersion(value) {
  const m = String(value || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  return m ? { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null } : null;
}

function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true }) > 0;
}

function showNotification(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  if (onClick) notification.on("click", onClick);
  notification.show();
}

function setupAutoUpdater() {
  if (updateStrategy !== "auto") return;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking", message: null });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "downloading",
      version: info.version,
      percent: 0,
      releaseUrl: releaseUrlFor(info.version),
      checkedAt: new Date().toISOString(),
    });
    log.info("Update available, downloading:", info.version);
    if (notifiedVersion !== info.version) {
      notifiedVersion = info.version;
      showNotification(
        "Cool Router update available",
        `Downloading version ${info.version} in the background…`
      );
    }
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: "not-available",
      version: null,
      percent: null,
      checkedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({ status: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    setUpdateState({ status: "downloaded", version: info.version, percent: 100 });
    log.info("Update downloaded:", info.version);
    refreshTray(); // adds "Restart to Update"
    showNotification(
      "Cool Router update ready",
      `Version ${info.version} is ready. Click to restart and update.`,
      () => installUpdate()
    );
    try {
      const { response } = await dialog.showMessageBox({
        type: "info",
        title: "Update ready",
        message: `Cool Router ${info.version} is ready to install.`,
        detail: "Restart now to update, or it will be installed the next time you quit.",
        buttons: ["Restart to update", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) installUpdate();
    } catch {
      /* dialog unavailable — notification + tray item still offer the restart */
    }
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({ status: "error", message: error?.message || String(error) });
  });
}

// macOS / .deb: no self-install. Ask GitHub for the latest release and link to it.
async function checkGitHubRelease(mode) {
  setUpdateState({ status: "checking", message: null });
  const res = await net.fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `cool-router-desktop/${app.getVersion()}`,
    },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = await res.json();
  const latest = String(body.tag_name || "").replace(/^v/i, "");
  const checkedAt = new Date().toISOString();
  if (!isNewerVersion(latest, app.getVersion())) {
    setUpdateState({ status: "not-available", version: null, checkedAt });
    if (mode === "tray") showUpToDateDialog();
    return;
  }
  const releaseUrl = body.html_url || releaseUrlFor(latest);
  setUpdateState({ status: "available", version: latest, releaseUrl, checkedAt });
  refreshTray();
  if (notifiedVersion !== latest || mode === "tray") {
    notifiedVersion = latest;
    const hint = isMac ? "Click to download the new .dmg." : "Click to download the new package.";
    showNotification(`Cool Router ${latest} is available`, hint, () =>
      shell.openExternal(releaseUrl)
    );
  }
}

function showUpToDateDialog() {
  dialog
    .showMessageBox({
      type: "info",
      title: "No updates",
      message: `You're on the latest version (${app.getVersion()}).`,
    })
    .catch(() => {});
}

/**
 * mode: "background" (launch + every 6h: quiet on errors),
 *       "tray" (menu click: dialogs for "up to date"),
 *       "ui" (Settings button in the dashboard: result shown in-app).
 */
async function checkForUpdates(mode = "background") {
  const silent = mode === "background";
  if (isDev) {
    if (!silent) setUpdateState({ status: "error", message: "Updates are disabled in dev mode" });
    return;
  }
  if (updateChecksDisabled) {
    setUpdateState({ status: "disabled", message: "COOLROUTER_DISABLE_UPDATE_CHECK is set" });
    return;
  }
  // Don't restart a download that is already underway or finished.
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    sendToRenderer("update-status", updateState);
    return;
  }
  try {
    if (updateStrategy === "auto") {
      const result = await autoUpdater.checkForUpdates();
      if (
        mode === "tray" &&
        result &&
        !isNewerVersion(result.updateInfo?.version, app.getVersion())
      ) {
        showUpToDateDialog();
      }
    } else {
      await checkGitHubRelease(mode);
    }
  } catch (error) {
    const message = error?.message || String(error);
    log.warn("Update check failed:", message);
    // Offline or rate-limited: stay quiet on background checks.
    setUpdateState({ status: silent ? "idle" : "error", message });
    if (mode === "tray") {
      dialog
        .showMessageBox({
          type: "warning",
          title: "Update check failed",
          message: "Couldn't check for updates.",
          detail: message,
        })
        .catch(() => {});
    }
  }
}

function scheduleUpdateChecks() {
  if (isDev || updateChecksDisabled) return;
  setTimeout(() => checkForUpdates("background"), 5000);
  updateTimer = setInterval(() => checkForUpdates("background"), UPDATE_CHECK_INTERVAL_MS);
}

async function downloadUpdate() {
  if (updateStrategy === "auto") {
    await autoUpdater.downloadUpdate();
  } else {
    await shell.openExternal(updateState.releaseUrl || RELEASES_PAGE_URL);
  }
}

function installUpdate() {
  if (updateStrategy !== "auto" || updateState.status !== "downloaded") {
    shell.openExternal(updateState.releaseUrl || RELEASES_PAGE_URL);
    return;
  }
  app.isQuitting = true;
  if (updateTimer) clearInterval(updateTimer);
  stopNextServer();
  autoUpdater.quitAndInstall();
}

// ── Content Security Policy ────────────────────────────────
function setupContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      `connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*`,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob:",
    ].join("; ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

// ── Window ─────────────────────────────────────────────────
function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    return (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      Number(parsed.port) === serverPort
    );
  } catch {
    return false;
  }
}

function openExternalSafely(url) {
  try {
    const parsedUrl = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
      shell.openExternal(url);
    } else {
      log.warn("Blocked unsafe protocol:", parsedUrl.protocol);
    }
  } catch {
    log.warn("Blocked invalid URL:", String(url).slice(0, 200));
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    loadCurrentContent();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const platformWindowOptions = isMac
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } }
    : { titleBarStyle: "default", autoHideMenuBar: true };

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // 1024 keeps the sidebar visible, which on macOS is what sits under the traffic lights.
    minWidth: 1024,
    minHeight: 640,
    title: "Cool Router",
    icon: path.join(RESOURCES_PATH, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
    show: false,
    backgroundColor: "#000000",
    ...platformWindowOptions,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Links to other sites open in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  // The dashboard failed to load (server stopped, port changed under us): show the
  // splash/error page instead of Chromium's "This site can't be reached".
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED: superseded navigation */) return;
    if (String(url).startsWith("file:")) return;
    log.warn(`Page failed to load (${errorCode} ${description}): ${url}`);
    if (serverState.status === "running") {
      setServerState({
        status: "error",
        error: `The dashboard could not be loaded (${description}).`,
      });
    }
    loadSplash();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("Renderer process gone:", details.reason);
    if (details.reason !== "clean-exit" && mainWindow && !mainWindow.isDestroyed()) {
      loadCurrentContent();
    }
  });

  // Closing the window keeps the router running in the background.
  mainWindow.on("close", (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    if (isLinux) {
      // Not every Linux desktop shows tray icons; a hidden window could be unreachable.
      mainWindow.minimize();
      return;
    }
    mainWindow.hide();
    if (isWindows && !desktopConfig.closeNoticeShown) {
      saveDesktopConfig({ closeNoticeShown: true });
      showNotification(
        "Cool Router is still running",
        "Your endpoint stays available. Use the tray icon to reopen or quit.",
        () => showMainWindow()
      );
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function loadSplash() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow
    .loadFile(SPLASH_PAGE)
    .catch((error) => log.warn("Splash failed to load:", error.message));
}

function loadDashboard() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(getServerUrl()).catch(() => {
    /* did-fail-load shows the error page */
  });
}

function loadCurrentContent() {
  if (serverState.status === "running") loadDashboard();
  else loadSplash();
}

// ── Application menu ───────────────────────────────────────
function buildApplicationMenu() {
  const helpItems = [
    { label: "Documentation", click: () => shell.openExternal(DOCS_URL) },
    { label: "Open Data Folder", click: () => shell.openPath(dataDir) },
    { label: "Open Logs", click: () => openLogs() },
    { label: "Reset Dashboard Password…", click: () => resetDashboardPassword() },
    { type: "separator" },
    { label: "Check for Updates…", click: () => checkForUpdates("tray") },
  ];

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : [
          {
            label: "File",
            submenu: [{ label: "Quit Cool Router", accelerator: "Ctrl+Q", click: () => quitApp() }],
          },
        ]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
    ...(isMac ? [{ role: "windowMenu" }] : []),
    { role: "help", submenu: helpItems },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openLogs() {
  const file = getLogFile();
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else shell.openPath(getLogDir());
}

function quitApp() {
  app.isQuitting = true;
  app.quit();
}

// ── System Tray ────────────────────────────────────────────
function loadTrayIcon() {
  const iconPath = path.join(RESOURCES_PATH, "assets", "tray-icon.png");
  try {
    if (isMac) {
      // The asset is 32px; register it as a @2x image so it draws at 16pt in the menu bar
      // instead of overflowing it.
      const image = nativeImage.createEmpty();
      image.addRepresentation({
        scaleFactor: 2,
        width: 32,
        height: 32,
        buffer: fs.readFileSync(iconPath),
      });
      if (!image.isEmpty()) return image;
    }
    const image = nativeImage.createFromPath(iconPath);
    return image.isEmpty() ? nativeImage.createEmpty() : image;
  } catch {
    return nativeImage.createEmpty();
  }
}

function buildTrayMenu() {
  const statusLabel =
    serverState.status === "running"
      ? `Running on port ${serverPort}`
      : serverState.status === "error"
        ? "Server not running"
        : "Starting…";

  return Menu.buildFromTemplate([
    { label: "Open Cool Router", click: () => showMainWindow() },
    {
      label: "Open in Browser",
      enabled: serverState.status === "running",
      click: () => shell.openExternal(getServerUrl()),
    },
    { type: "separator" },
    { label: statusLabel, enabled: false },
    {
      label: "Server Port",
      submenu: [...new Set([...PORT_CHOICES, serverPort])]
        .sort((a, b) => a - b)
        .map((port) => ({
          label: String(port),
          type: "radio",
          checked: port === serverPort,
          click: () => changePort(port),
        })),
    },
    {
      label: "Allow Access from Other Devices",
      type: "checkbox",
      checked: allowLanAccess,
      click: (item) => setLanAccess(item.checked),
    },
    { label: "Restart Server", click: () => restartServer().catch(() => {}) },
    { type: "separator" },
    ...(updateState.status === "downloaded"
      ? [{ label: `Restart to Update (${updateState.version})`, click: () => installUpdate() }]
      : updateState.status === "available"
        ? [
            {
              label: `Download Cool Router ${updateState.version}…`,
              click: () => shell.openExternal(updateState.releaseUrl || RELEASES_PAGE_URL),
            },
          ]
        : []),
    { label: "Check for Updates…", click: () => checkForUpdates("tray") },
    { label: "Open Logs", click: () => openLogs() },
    { label: "Reset Dashboard Password…", click: () => resetDashboardPassword() },
    { type: "separator" },
    { label: "Quit Cool Router", click: () => quitApp() },
  ]);
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(loadTrayIcon());
  } catch (error) {
    log.warn("Tray is unavailable:", error.message);
    tray = null;
    return;
  }
  tray.on("click", () => {
    // macOS opens the menu on click; elsewhere a click brings the window back.
    if (!isMac) showMainWindow();
  });
  tray.on("double-click", () => showMainWindow());
  refreshTray();
}

// Rebuild the menu in place. (Destroying and recreating the Tray makes the icon jump
// around the notification area and leaves ghost icons behind on Windows.)
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(
    serverState.status === "running" ? `Cool Router — port ${serverPort}` : "Cool Router"
  );
  tray.setContextMenu(buildTrayMenu());
}

// ── Server settings changed from the tray ──────────────────
async function changePort(newPort) {
  if (newPort === serverPort) return;

  if (!(await isPortFree(newPort))) {
    refreshTray(); // put the radio selection back
    dialog
      .showMessageBox({
        type: "warning",
        title: "Port in use",
        message: `Port ${newPort} is already used by another program.`,
        detail: `Cool Router stays on port ${serverPort}.`,
      })
      .catch(() => {});
    return;
  }

  const oldPort = serverPort;
  serverPort = newPort;
  saveDesktopConfig({ port: newPort });
  log.info(`Port changed: ${oldPort} → ${newPort}`);
  sendToRenderer("port-changed", serverPort);
  await restartServer();
}

async function setLanAccess(enabled) {
  if (enabled === allowLanAccess) return;
  if (enabled) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Allow access from other devices?",
      message: "Make Cool Router reachable from other devices on your network?",
      detail:
        "Anyone on the same network will be able to reach the dashboard and API on this " +
        "computer. Set a dashboard password and require API keys first. Your firewall may " +
        "ask for permission.",
      buttons: ["Allow", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) {
      refreshTray();
      return;
    }
  }
  allowLanAccess = enabled;
  saveDesktopConfig({ allowLanAccess: enabled });
  log.info("LAN access", enabled ? "enabled" : "disabled");
  await restartServer();
}

// ── Server Lifecycle ───────────────────────────────────────
function describeStartFailure(lastLines) {
  const tail = lastLines.join("\n");
  if (/EADDRINUSE/.test(tail)) return `Port ${serverPort} is already in use by another program.`;
  if (/NODE_MODULE_VERSION|was compiled against a different Node\.js version/.test(tail)) {
    return "A bundled component does not match this version of the app. Reinstalling Cool Router fixes this.";
  }
  if (/SQLITE_CANTOPEN|EACCES|EPERM/.test(tail)) {
    return `Cool Router could not write to its data folder:\n${dataDir}`;
  }
  if (/SQLITE_CORRUPT|database disk image is malformed/.test(tail)) {
    return "The database file is damaged. Restore a backup from the db_backups folder in the data folder.";
  }
  return "The server did not start. The log has the details.";
}

/** Start the bundled server and wait until it answers. Resolves to true when it is up. */
function startNextServer() {
  if (startInFlight) return startInFlight;
  startInFlight = startNextServerOnce().finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

async function startNextServerOnce() {
  if (isDev) {
    // Dev: connect to a Next.js server started separately (npm run dev).
    log.info("Dev mode — expecting a Next.js server on port", serverPort);
    const up = await waitForServer(getServerUrl(), null, 15_000);
    setServerState(
      up
        ? { status: "running", error: null }
        : {
            status: "error",
            error: `No dev server on port ${serverPort}. Run "npm run dev" first.`,
          }
    );
    return up;
  }

  setServerState({ status: "starting", error: null });

  const serverScript = path.join(NEXT_SERVER_PATH, "server.js");
  if (!fs.existsSync(serverScript)) {
    log.error("Server script not found:", serverScript);
    setServerState({
      status: "error",
      error: "The installation is incomplete (server files are missing). Reinstall Cool Router.",
    });
    return false;
  }

  let prepared;
  try {
    prepared = await prepareServerEnvironment();
  } catch (error) {
    log.error("Could not prepare the server environment:", error);
    setServerState({
      status: "error",
      error: `Could not prepare the data folder:\n${error.message}`,
    });
    return false;
  }
  if (!prepared) {
    // The user chose not to continue without the encryption key.
    quitApp();
    return false;
  }
  const { serverEnv, nodeExecutable } = prepared;

  const port = await pickAvailablePort(serverPort, nodeExecutable);
  if (port === null) {
    setServerState({
      status: "error",
      error: `Port ${serverPort} and the ports after it are in use by other programs.`,
    });
    return false;
  }
  if (port !== serverPort) {
    log.warn(`Port ${serverPort} is in use by another program — using ${port} for this session.`);
    serverPort = port;
    sendToRenderer("port-changed", serverPort);
  }

  // The desktop app is local-first: listen on loopback unless LAN access was turned on.
  const host = allowLanAccess ? "0.0.0.0" : "127.0.0.1";

  log.info(`Starting server on ${host}:${serverPort} with ${nodeExecutable}`);

  const startupLines = [];
  const proc = spawn(nodeExecutable, [serverScript], {
    cwd: NEXT_SERVER_PATH,
    env: {
      ...serverEnv,
      DATA_DIR: dataDir,
      PORT: String(serverPort),
      HOSTNAME: host,
      COOLROUTER_INSTALL_KIND: "desktop",
      // The server exits on its own if this process disappears (crash, force-close,
      // installer) instead of lingering and holding the port and the install folder.
      COOLROUTER_PARENT_PID: String(process.pid),
      // …and shuts down cleanly when we close its stdin (see stopNextServer).
      COOLROUTER_PARENT_STDIN: "1",
      NODE_ENV: "production",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  proc.stdin?.on("error", () => {}); // the server may already be gone when we close it
  nextServer = proc;
  // Bookkeeping lives on the process object so a late event from an old server can
  // never be mistaken for the current one.
  proc.stoppedOnPurpose = false;
  proc.startupFinished = false;

  const capture = (level) => (data) => {
    for (const line of data.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (startupLines.length < 400) startupLines.push(line);
      writeLog(level, [`[server] ${line}`]);
    }
  };
  proc.stdout?.on("data", capture("info"));
  proc.stderr?.on("data", capture("warn"));

  proc.on("error", (error) => {
    log.error("Failed to launch the server process:", error);
    startupLines.push(String(error.message || error));
  });

  proc.on("exit", (code, signal) => {
    log.info(`Server exited (code ${code}, signal ${signal})`);
    if (nextServer === proc) {
      nextServer = null;
      stopLoopbackBridge();
    }
    if (proc.stoppedOnPurpose || app.isQuitting) return;
    // A crash during startup is reported below, once waitForServer() gives up.
    if (proc.startupFinished) handleUnexpectedServerExit(code, startupLines);
  });

  const answered = await waitForServer(getServerUrl(), proc);
  if (proc.stoppedOnPurpose) return false; // stopped or replaced while starting

  const exited = proc.exitCode !== null || proc.signalCode !== null;
  const ready = answered && !exited;

  if (!ready) {
    log.error(exited ? "Server exited during startup." : "Server did not answer in time.");
    if (!exited) {
      proc.stoppedOnPurpose = true;
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      if (nextServer === proc) nextServer = null;
    }
    setServerState({
      status: "error",
      error: exited
        ? describeStartFailure(startupLines.slice(-60))
        : "The server took too long to start. Try again — the first launch can be slow.",
    });
    return false;
  }

  proc.startupFinished = true;
  startLoopbackBridge(serverPort);
  setServerState({ status: "running", error: null });
  log.info("Server is ready at", getServerUrl());
  return true;
}

/** A server that was up and running died on its own: bring it back, within reason. */
function handleUnexpectedServerExit(code, startupLines) {
  const now = Date.now();
  restartHistory = restartHistory.filter((time) => now - time < AUTO_RESTART_WINDOW_MS);
  if (restartHistory.length >= MAX_AUTO_RESTARTS) {
    log.error("Server keeps stopping — not restarting it again automatically.");
    setServerState({
      status: "error",
      error: `The server stopped unexpectedly (exit code ${code}) several times.\n${describeStartFailure(startupLines.slice(-60))}`,
    });
    loadSplash();
    return;
  }
  restartHistory.push(now);
  log.warn(`Server stopped unexpectedly (exit code ${code}) — restarting.`);
  setServerState({ status: "restarting", error: null });
  startNextServer().then((ok) => {
    if (!ok) loadSplash();
  });
}

function stopNextServer() {
  stopLoopbackBridge();
  const proc = nextServer;
  if (!proc) return null;
  proc.stoppedOnPurpose = true;
  nextServer = null;
  // Closing stdin asks the server to drain requests, checkpoint the database and exit.
  // On Windows that is the only graceful option: kill() there is an immediate
  // TerminateProcess. Callers that need the port back wait with waitForServerExit(),
  // which force-kills after a timeout.
  try {
    proc.stdin?.end();
  } catch {
    /* already closed */
  }
  if (!isWindows) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  }
  return proc;
}

async function restartServer() {
  // Let a start that is already underway finish first so two servers never overlap.
  if (startInFlight) await startInFlight.catch(() => {});
  setServerState({ status: "restarting", error: null });
  const wasShowingDashboard =
    mainWindow && !mainWindow.isDestroyed() && isHttpUrl(mainWindow.webContents.getURL());
  if (!wasShowingDashboard) loadSplash();
  await waitForServerExit(stopNextServer());
  const ok = await startNextServer();
  if (ok) loadDashboard();
  else loadSplash();
  return ok;
}

function isHttpUrl(url) {
  return /^https?:/i.test(String(url || ""));
}

/**
 * Forgotten password. Whoever can click this menu already has full access to the data
 * folder on this computer, so no further proof is asked: the stored password is removed
 * and the dashboard opens without signing in until a new one is set.
 */
async function resetDashboardPassword() {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Reset dashboard password",
    message: "Remove the dashboard password?",
    detail:
      "The dashboard will open without signing in until you set a new password under " +
      "Settings → Security. Providers, API keys and usage history are not affected.",
    buttons: ["Reset password", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;

  const dbPath = path.join(dataDir, "storage.sqlite");
  if (!fs.existsSync(dbPath)) {
    dialog
      .showMessageBox({ type: "info", message: "No password has been set yet." })
      .catch(() => {});
    return;
  }

  // The database belongs to the server's Node.js runtime (see hasEncryptedCredentials).
  const script = `
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1], { fileMustExist: true });
    try {
      db.prepare("DELETE FROM key_value WHERE namespace = 'settings' AND key = 'password'").run();
    } finally {
      db.close();
    }
  `;

  if (startInFlight) await startInFlight.catch(() => {});
  setServerState({ status: "restarting", error: null });
  loadSplash();
  await waitForServerExit(stopNextServer());

  const result = spawnSync(resolveNodeExecutable(process.env), ["-e", script, dbPath], {
    cwd: NEXT_SERVER_PATH,
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  const failed = result.status !== 0;
  if (failed) {
    log.error("Password reset failed:", (result.stderr || result.error?.message || "").trim());
  } else {
    log.info("Dashboard password removed from the tray menu.");
  }

  const ok = await startNextServer();
  if (ok && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow
      .loadURL(failed ? getServerUrl() : `${getServerUrl()}/dashboard/settings?tab=security`)
      .catch(() => {});
    showMainWindow();
  }
  if (failed) {
    dialog
      .showMessageBox({
        type: "error",
        title: "Reset dashboard password",
        message: "The password could not be reset.",
        detail: "The log has the details (Help → Open Logs).",
      })
      .catch(() => {});
  }
}

// ── IPC Handlers ───────────────────────────────────────────
function setupIpcHandlers() {
  ipcMain.handle("get-app-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isDev,
    port: serverPort,
  }));

  ipcMain.handle("open-external", (_event, url) => openExternalSafely(url));

  ipcMain.handle("get-data-dir", () => dataDir);

  ipcMain.handle("get-server-state", () => ({
    ...serverState,
    version: app.getVersion(),
    logFile: getLogFile(),
    logTail: recentLogLines.slice(-25),
  }));

  ipcMain.handle("restart-server", async () => ({ success: await restartServer() }));

  ipcMain.handle("open-logs", () => openLogs());
  ipcMain.handle("open-data-dir", () => shell.openPath(dataDir));
  ipcMain.handle("quit-app", () => quitApp());

  // Window controls
  ipcMain.on("window-minimize", () => mainWindow?.minimize());

  ipcMain.on("window-maximize", () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });

  ipcMain.on("window-close", () => mainWindow?.close());

  // Auto-update IPC handlers
  ipcMain.handle("check-for-updates", async () => {
    try {
      await checkForUpdates("ui");
      return { success: true, state: updateState };
    } catch (error) {
      log.error("Check for updates failed:", error);
      setUpdateState({ status: "error", message: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("download-update", async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch (error) {
      log.error("Download update failed:", error);
      setUpdateState({ status: "error", message: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("install-update", () => {
    installUpdate();
    // No return value — app will quit and restart
  });

  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("get-update-state", () => updateState);
}

// ── App Lifecycle ──────────────────────────────────────────
app.whenReady().then(async () => {
  // Resolve the data folder exactly like the server does (a .env next to the data can
  // move it), then load what the desktop shell itself remembers.
  const preferredEnv = parseEnvFile(getPreferredEnvFilePath(process.env));
  dataDir = resolveDataDir(null, { ...preferredEnv, ...process.env });
  initLogging();
  loadDesktopConfig();
  serverPort =
    parsePort(process.env.PORT) ||
    parsePort(preferredEnv.PORT) ||
    parsePort(desktopConfig.port) ||
    DEFAULT_PORT;
  allowLanAccess = desktopConfig.allowLanAccess === true;
  serverState = { status: "starting", port: serverPort, error: null };

  log.info(
    `Cool Router ${app.getVersion()} starting (${process.platform} ${process.arch}, Electron ${process.versions.electron})`
  );
  log.info("Data folder:", dataDir);

  setupContentSecurityPolicy();
  setupIpcHandlers();
  buildApplicationMenu();

  // Show the window first (on the splash page), then bring the server up behind it.
  createWindow();
  loadSplash();
  createTray();
  setupAutoUpdater();

  // macOS: clicking the dock icon brings the window back
  app.on("activate", () => showMainWindow());

  const ok = await startNextServer();
  if (ok) loadDashboard();

  // Check for updates shortly after launch, then every 6 hours (never blocks startup)
  scheduleUpdateChecks();
});

// The window hides to the tray instead of closing, so this only fires when quitting.
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

// Clean up before quit
app.on("before-quit", () => {
  app.isQuitting = true;
  if (updateTimer) clearInterval(updateTimer);
  stopNextServer();
});

app.on("will-quit", () => {
  try {
    logStream?.end();
  } catch {
    /* ignore */
  }
});

// Global error handlers
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
});
