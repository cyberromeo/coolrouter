/**
 * Cool Router Electron Desktop App - Preload Script
 *
 * Secure bridge between renderer (Next.js) and main process (Electron).
 * Uses contextIsolation: true — the page only ever sees the functions exposed below.
 */

const { contextBridge, ipcRenderer } = require("electron");

// ── Channel Whitelist ──────────────────────────────────────
const VALID_CHANNELS = {
  invoke: [
    "get-app-info",
    "open-external",
    "get-data-dir",
    "get-server-state",
    "restart-server",
    "open-logs",
    "open-data-dir",
    "quit-app",
    "check-for-updates",
    "download-update",
    "install-update",
    "get-app-version",
    "get-update-state",
  ],
  send: ["window-minimize", "window-maximize", "window-close"],
  receive: ["server-status", "port-changed", "update-status"],
};

function safeInvoke(channel, ...args) {
  if (!VALID_CHANNELS.invoke.includes(channel)) {
    return Promise.reject(new Error(`Blocked IPC invoke: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function safeSend(channel, ...args) {
  if (VALID_CHANNELS.send.includes(channel)) {
    ipcRenderer.send(channel, ...args);
  }
}

// Returns a disposer so the caller removes only its own listener.
function safeOn(channel, callback) {
  if (!VALID_CHANNELS.receive.includes(channel)) return () => {};
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// ── Expose API to Renderer ─────────────────────────────────
contextBridge.exposeInMainWorld("electronAPI", {
  // ── Invoke (async, returns Promise) ──────────────────────
  getAppInfo: () => safeInvoke("get-app-info"),
  openExternal: (url) => safeInvoke("open-external", url),
  getDataDir: () => safeInvoke("get-data-dir"),
  getServerState: () => safeInvoke("get-server-state"),
  restartServer: () => safeInvoke("restart-server"),
  openLogs: () => safeInvoke("open-logs"),
  openDataDir: () => safeInvoke("open-data-dir"),
  quitApp: () => safeInvoke("quit-app"),
  getAppVersion: () => safeInvoke("get-app-version"),

  // ── Auto-Update ──────────────────────────────────────────
  checkForUpdates: () => safeInvoke("check-for-updates"),
  downloadUpdate: () => safeInvoke("download-update"),
  installUpdate: () => safeInvoke("install-update"),
  getUpdateState: () => safeInvoke("get-update-state"),

  // ── Send (fire-and-forget) ───────────────────────────────
  minimizeWindow: () => safeSend("window-minimize"),
  maximizeWindow: () => safeSend("window-maximize"),
  closeWindow: () => safeSend("window-close"),

  // ── Receive (event listeners) ────────────────────────────
  onServerStatus: (callback) => safeOn("server-status", callback),
  onPortChanged: (callback) => safeOn("port-changed", callback),
  onUpdateStatus: (callback) => safeOn("update-status", callback),

  // ── Static Properties ────────────────────────────────────
  isElectron: true,
  platform: process.platform,
});

// Tag <html> with the desktop platform before the first paint, so CSS can adapt on every
// page — including sign-in and the setup wizard — without waiting for React. On macOS
// the title bar is hidden, and `html.desktop-macos` adds the draggable strip that lets
// the window be moved (see globals.css).
function tagDocument() {
  const root = document.documentElement;
  if (!root) return false;
  root.classList.add(
    "desktop",
    `desktop-${process.platform === "darwin" ? "macos" : process.platform}`
  );
  return true;
}

if (!tagDocument()) {
  const observer = new MutationObserver(() => {
    if (tagDocument()) observer.disconnect();
  });
  observer.observe(document, { childList: true });
}
window.addEventListener("DOMContentLoaded", tagDocument);
