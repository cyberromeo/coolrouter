/**
 * Cool Router Electron Types
 *
 * TypeScript definitions for the Electron API exposed to the renderer process.
 *
 * Updated to reflect:
 * - Fix #6: onServerStatus/onPortChanged return disposer functions
 * - Removed removeServerStatusListener/removePortChangedListener (replaced by disposers)
 */

export interface AppInfo {
  name: string;
  version: string;
  platform: "win32" | "darwin" | "linux";
  isDev: boolean;
  port: number;
}

export interface ServerStatus {
  status: "starting" | "running" | "stopped" | "restarting" | "error";
  port: number;
}

export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "not-available"
    | "error"
    | "disabled";
  /** "auto": downloads + restart to update (Windows, AppImage). "notify": link to the release (macOS, .deb). */
  strategy: "auto" | "notify";
  currentVersion: string;
  version: string | null;
  percent: number | null;
  releaseUrl: string;
  message: string | null;
  checkedAt: string | null;
}

export interface ElectronAPI {
  // ── Invoke (async) ─────────────────────────────────────
  getAppInfo(): Promise<AppInfo>;
  openExternal(url: string): Promise<void>;
  getDataDir(): Promise<string>;
  restartServer(): Promise<{ success: boolean }>;
  getAppVersion(): Promise<string>;
  checkForUpdates(): Promise<{ success: boolean; state?: UpdateState; error?: string }>;
  downloadUpdate(): Promise<{ success: boolean; error?: string }>;
  installUpdate(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;

  // ── Send (fire-and-forget) ─────────────────────────────
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;

  // ── Receive (returns disposer for cleanup) ─────────────
  onServerStatus(callback: (data: ServerStatus) => void): () => void;
  onPortChanged(callback: (port: number) => void): () => void;
  onUpdateStatus(callback: (state: UpdateState) => void): () => void;

  // ── Static Properties ──────────────────────────────────
  isElectron: boolean;
  platform: "win32" | "darwin" | "linux";
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
