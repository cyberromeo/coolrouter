/**
 * Cool Router Desktop App - Main Process
 *
 * This is the entry point for the Electron desktop application.
 * It manages the main window, system tray, server lifecycle, and IPC communication.
 *
 * Code Review Fixes Applied:
 * #1  Server readiness — wait for health check before loading window
 * #2  Restart timeout — 5s timeout + SIGKILL to prevent hanging
 * #3  changePort — stop + restart server on new port
 * #4  Tray cleanup — destroy old tray before recreating
 * #5  Emit server-status/port-changed IPC events
 * #8  Removed dead isProduction variable
 * #9  Platform-conditional titleBarStyle
 * #10 stdio: pipe + stdout/stderr capture for readiness detection
 * #14 Removed dead coolrouter:// protocol (no handler existed)
 * #15 Content Security Policy via session headers
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
const { spawn } = require("child_process");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// ── Single Instance Lock ───────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── Environment Detection ──────────────────────────────────
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// ── Paths ──────────────────────────────────────────────────
const APP_PATH = app.getAppPath();
const RESOURCES_PATH = !isDev ? process.resourcesPath : APP_PATH;
const NEXT_SERVER_PATH = path.join(RESOURCES_PATH, "app");

// ── State ──────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let nextServer = null;
let serverPort = 20128;

const getServerUrl = () => `http://localhost:${serverPort}`;

function resolveNodeExecutable(env = process.env) {
  // Prefer the Node.js runtime bundled with the installer (resources/node), so
  // users don't need Node installed and native modules match its ABI.
  const bundledNode = process.resourcesPath
    ? path.join(process.resourcesPath, "node", process.platform === "win32" ? "node.exe" : "node")
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

function resolveDataDir(overridePath, env = process.env) {
  if (overridePath && overridePath.trim()) return path.resolve(overridePath);

  const configured = env.DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  if (process.platform === "win32") {
    const appData = env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming");
    return path.join(appData, "coolrouter");
  }

  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(path.resolve(xdg), "coolrouter");

  return path.join(require("os").homedir(), ".coolrouter");
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

function hasEncryptedCredentials(dbPath) {
  if (!fs.existsSync(dbPath)) return false;

  try {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          `SELECT 1
             FROM provider_connections
            WHERE access_token LIKE 'enc:v1:%'
               OR refresh_token LIKE 'enc:v1:%'
               OR api_key LIKE 'enc:v1:%'
               OR id_token LIKE 'enc:v1:%'
            LIMIT 1`
        )
        .get();
      return !!row;
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect existing database at ${dbPath}: ${message}`);
  }
}

// ── Auto-Updater Configuration ──────────────────────────────
// Updates come from GitHub Releases (cyberromeo/coolrouter): latest.yml (Windows),
// latest-linux.yml (AppImage). How an update is applied depends on the package:
//   • Windows NSIS + Linux AppImage → electron-updater downloads it, then "Restart to update"
//   • macOS (.dmg, unsigned) + Linux .deb → can't self-install, so we check the GitHub
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
  if (process.platform === "win32") return "auto";
  if (process.platform === "linux" && process.env.APPIMAGE) return "auto";
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
autoUpdater.logger = console;

// ── Helper: Send IPC event to renderer (#5) ────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── Helper: Wait for server readiness (#1, #10) ────────────
async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      /* server not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn("[Electron] Server readiness timeout — showing window anyway");
  return false;
}

// ── Helper: Wait for server process exit with timeout (#2) ─
async function waitForServerExit(proc, timeoutMs = 5000) {
  if (!proc) return;
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

function showUpdateNotification(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  if (onClick) notification.on("click", onClick);
  notification.show();
}

function setupAutoUpdater() {
  if (updateStrategy !== "auto") return;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking", message: null });
    console.log("[Electron] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "downloading",
      version: info.version,
      percent: 0,
      releaseUrl: releaseUrlFor(info.version),
      checkedAt: new Date().toISOString(),
    });
    console.log("[Electron] Update available, downloading:", info.version);
    if (notifiedVersion !== info.version) {
      notifiedVersion = info.version;
      showUpdateNotification(
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
    console.log("[Electron] No update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({ status: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    setUpdateState({ status: "downloaded", version: info.version, percent: 100 });
    console.log("[Electron] Update downloaded:", info.version);
    createTray(); // adds "Restart to Update"
    showUpdateNotification(
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
    console.error("[Electron] Update error:", error);
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
  createTray();
  if (notifiedVersion !== latest || mode === "tray") {
    notifiedVersion = latest;
    const hint =
      process.platform === "darwin"
        ? "Click to download the new .dmg."
        : "Click to download the new package.";
    showUpdateNotification(`Cool Router ${latest} is available`, hint, () =>
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
    console.log("[Electron] Dev mode — skipping update check");
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
    console.warn("[Electron] Update check failed:", message);
    // Offline or rate-limited: stay quiet on background checks.
    setUpdateState({ status: silent ? "idle" : "error", message });
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
  if (nextServer) {
    nextServer.kill("SIGTERM");
    nextServer = null;
  }
  autoUpdater.quitAndInstall();
}

// ── Content Security Policy (#15) ──────────────────────────
function setupContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      `connect-src 'self' http://localhost:* ws://localhost:*`,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self'",
    ].join("; ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

// ── Create Window ──────────────────────────────────────────
function createWindow() {
  // Platform-conditional options (#9)
  const platformWindowOptions =
    process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarStyle: "default" };

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Cool Router",
    icon: path.join(RESOURCES_PATH, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false,
    backgroundColor: "#0a0a0a",
    ...platformWindowOptions,
  });

  // Load the Next.js app
  mainWindow.loadURL(getServerUrl());
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle external links — validate URL protocol to prevent RCE
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (["http:", "https:"].includes(parsedUrl.protocol)) {
        shell.openExternal(url);
      } else {
        console.warn("[Electron] Blocked unsafe protocol:", parsedUrl.protocol);
      }
    } catch {
      console.error("[Electron] Blocked invalid URL:", url);
    }
    return { action: "deny" };
  });

  // Handle window close — minimize to tray
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── System Tray ────────────────────────────────────────────
function createTray() {
  // Fix #4: Destroy old tray before recreating
  if (tray) {
    tray.destroy();
    tray = null;
  }

  const iconPath = path.join(RESOURCES_PATH, "assets", "tray-icon.png");
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Cool Router",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Open Dashboard",
      click: () => shell.openExternal(getServerUrl()),
    },
    { type: "separator" },
    {
      label: "Server Port",
      submenu: [
        { label: `Port: ${serverPort}`, enabled: false },
        { type: "separator" },
        { label: "20128", click: () => changePort(20128) },
        { label: "3000", click: () => changePort(3000) },
        { label: "8080", click: () => changePort(8080) },
      ],
    },
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
    {
      label: "Check for Updates",
      click: () => checkForUpdates("tray"),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Cool Router");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Change Port (#3: now restarts server) ──────────────────
async function changePort(newPort) {
  if (newPort === serverPort) return;

  const oldPort = serverPort;
  serverPort = newPort;

  sendToRenderer("server-status", { status: "restarting", port: newPort });

  // Stop current server and wait for exit
  const serverToStop = nextServer;
  stopNextServer();
  await waitForServerExit(serverToStop);

  // Start server on new port
  startNextServer();
  await waitForServer(getServerUrl());

  // Reload window and update tray
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(getServerUrl());
  }
  createTray();

  sendToRenderer("port-changed", serverPort);
  sendToRenderer("server-status", { status: "running", port: serverPort });
  console.log(`[Electron] Port changed: ${oldPort} → ${serverPort}`);
}

// ── Server Lifecycle (#1, #5, #10) ─────────────────────────
function startNextServer() {
  if (isDev) {
    console.log("[Electron] Dev mode — connect to existing Next.js server");
    sendToRenderer("server-status", { status: "running", port: serverPort });
    return;
  }

  const serverScript = path.join(NEXT_SERVER_PATH, "server.js");
  if (!fs.existsSync(serverScript)) {
    console.error("[Electron] Server script not found:", serverScript);
    sendToRenderer("server-status", { status: "error", port: serverPort });
    return;
  }

  // ── Zero-config bootstrap: auto-generate required secrets ─────────────────
  // Electron uses CJS — cannot dynamically import ESM bootstrap-env.mjs.
  // This mirrors bootstrap-env.mjs logic synchronously:
  //   1. Read persisted secrets from the resolved DATA_DIR/server.env
  //   2. Generate missing secrets with crypto.randomBytes()
  //   3. Persist back to DATA_DIR/server.env for future restarts
  const crypto = require("crypto");

  // Parse a simple KEY=VALUE file
  function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
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

  const preferredEnvPath = getPreferredEnvFilePath(process.env);
  const preferredEnv = preferredEnvPath ? parseEnvFile(preferredEnvPath) : {};
  const dataDir = resolveDataDir(null, { ...preferredEnv, ...process.env });
  const serverEnvPath = path.join(dataDir, "server.env");
  const persisted = parseEnvFile(serverEnvPath);
  const serverEnv = { ...persisted, ...preferredEnv, ...process.env };
  let changed = false;

  if (!serverEnv.JWT_SECRET) {
    serverEnv.JWT_SECRET = persisted.JWT_SECRET = crypto.randomBytes(64).toString("hex");
    changed = true;
    console.log("[Electron] ✨ JWT_SECRET auto-generated");
  }
  if (!serverEnv.STORAGE_ENCRYPTION_KEY) {
    if (hasEncryptedCredentials(path.join(dataDir, "storage.sqlite"))) {
      console.error(
        `[Electron] Refusing to auto-generate STORAGE_ENCRYPTION_KEY: encrypted credentials already exist in ${path.join(
          dataDir,
          "storage.sqlite"
        )}. Restore the key via ${preferredEnvPath || "an appropriate .env file"}, ${serverEnvPath}, or process.env.`
      );
      sendToRenderer("server-status", { status: "error", port: serverPort });
      return;
    }
    serverEnv.STORAGE_ENCRYPTION_KEY = persisted.STORAGE_ENCRYPTION_KEY = crypto
      .randomBytes(32)
      .toString("hex");
    serverEnv.STORAGE_ENCRYPTION_KEY_VERSION = persisted.STORAGE_ENCRYPTION_KEY_VERSION = "v1";
    changed = true;
    console.log("[Electron] ✨ STORAGE_ENCRYPTION_KEY auto-generated");
  }
  if (!serverEnv.API_KEY_SECRET) {
    serverEnv.API_KEY_SECRET = persisted.API_KEY_SECRET = crypto.randomBytes(32).toString("hex");
    changed = true;
    console.log("[Electron] ✨ API_KEY_SECRET auto-generated");
  }
  if (changed) {
    serverEnv.COOLROUTER_BOOTSTRAPPED = "true";
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const lines = [
        "# Auto-generated by Cool Router bootstrap",
        "",
        ...Object.entries(persisted).map(([k, v]) => `${k}=${v}`),
        "",
      ];
      fs.writeFileSync(serverEnvPath, lines.join("\n"), "utf8");
      console.log("[Electron] 📁 Secrets persisted to:", serverEnvPath);
    } catch (e) {
      console.warn("[Electron] Could not persist secrets:", e.message);
    }
  }

  const nodeExecutable = resolveNodeExecutable(serverEnv);

  console.log("[Electron] Starting Next.js server on port", serverPort);
  console.log("[Electron] Using Node executable:", nodeExecutable);
  sendToRenderer("server-status", { status: "starting", port: serverPort });

  // Fix #10: Use pipe instead of inherit for logging & readiness detection
  nextServer = spawn(nodeExecutable, [serverScript], {
    cwd: NEXT_SERVER_PATH,
    env: {
      ...serverEnv,
      DATA_DIR: dataDir,
      PORT: String(serverPort),
      COOLROUTER_INSTALL_KIND: "desktop",
      NODE_ENV: "production",
    },
    stdio: "pipe",
  });

  // Capture server output for logging
  nextServer.stdout?.on("data", (data) => {
    const text = data.toString();
    process.stdout.write(`[Server] ${text}`);

    // Detect server ready
    if (text.includes("Ready") || text.includes("started") || text.includes("listening")) {
      sendToRenderer("server-status", { status: "running", port: serverPort });
    }
  });

  nextServer.stderr?.on("data", (data) => {
    process.stderr.write(`[Server:err] ${data}`);
  });

  nextServer.on("error", (err) => {
    console.error("[Electron] Failed to start server:", err);
    sendToRenderer("server-status", { status: "error", port: serverPort });
  });

  nextServer.on("exit", (code) => {
    console.log("[Electron] Server exited with code:", code);
    sendToRenderer("server-status", { status: "stopped", port: serverPort });
    nextServer = null;
  });
}

function stopNextServer() {
  if (nextServer) {
    nextServer.kill("SIGTERM");
    nextServer = null;
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

  ipcMain.handle("open-external", (_event, url) => {
    try {
      const parsedUrl = new URL(url);
      if (["http:", "https:"].includes(parsedUrl.protocol)) {
        shell.openExternal(url);
      }
    } catch {
      console.error("[Electron] Blocked invalid URL:", url);
    }
  });

  ipcMain.handle("get-data-dir", () => app.getPath("userData"));

  // Fix #2: Add timeout to restart
  ipcMain.handle("restart-server", async () => {
    const serverToStop = nextServer;
    stopNextServer();
    await waitForServerExit(serverToStop);
    startNextServer();
    await waitForServer(getServerUrl());
    return { success: true };
  });

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
      console.error("[Electron] Check for updates failed:", error);
      setUpdateState({ status: "error", message: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("download-update", async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error("[Electron] Download update failed:", error);
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
  // Fix #15: Set up CSP before any content loads
  setupContentSecurityPolicy();

  // Fix #1: Start server and WAIT for readiness before showing window
  startNextServer();
  if (!isDev) {
    await waitForServer(getServerUrl());
  }

  createWindow();
  createTray();
  setupIpcHandlers();
  setupAutoUpdater();

  // Check for updates shortly after launch, then every 6 hours (never blocks startup)
  scheduleUpdateChecks();

  // macOS: recreate window when dock icon clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

// Quit when all windows closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up before quit
app.on("before-quit", () => {
  app.isQuitting = true;
  stopNextServer();
});

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("[Electron] Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Electron] Unhandled Rejection:", reason);
});
