"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsElectron } from "@/shared/hooks/useElectron";

/** Server answer from GET/POST /api/system/version. */
export type ServerUpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkDisabled: boolean;
  checkedAt: string | null;
  error: string | null;
  release: {
    version: string;
    tag: string;
    name: string;
    url: string;
    publishedAt: string | null;
  } | null;
  releasesUrl: string;
  install: "docker" | "desktop" | "source";
  upgradeCommand: string | null;
};

/** State pushed by the Electron main process (see electron/main.js). */
export type DesktopUpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "not-available"
    | "error"
    | "disabled";
  strategy: "auto" | "notify";
  currentVersion: string;
  version: string | null;
  percent: number | null;
  releaseUrl: string;
  message: string | null;
  checkedAt: string | null;
};

type ElectronUpdateApi = {
  isElectron?: boolean;
  getUpdateState?: () => Promise<DesktopUpdateState>;
  checkForUpdates?: () => Promise<{ success: boolean; state?: DesktopUpdateState }>;
  installUpdate?: () => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  onUpdateStatus?: (cb: (state: DesktopUpdateState) => void) => () => void;
};

function getElectronApi(): ElectronUpdateApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: ElectronUpdateApi }).electronAPI;
  return api?.isElectron ? api : null;
}

export function useUpdateStatus() {
  const [server, setServer] = useState<ServerUpdateStatus | null>(null);
  const [desktop, setDesktop] = useState<DesktopUpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const isDesktop = useIsElectron();

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch("/api/system/version", {
        method: force ? "POST" : "GET",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ServerUpdateStatus;
      setServer(data);
      return data;
    } catch {
      return null; // offline: stay quiet
    }
  }, []);

  useEffect(() => {
    load(false);
    const api = getElectronApi();
    if (!api) return;
    api
      .getUpdateState?.()
      .then((state) => state && setDesktop(state))
      .catch(() => {});
    const dispose = api.onUpdateStatus?.((state) => {
      if (state && typeof state === "object" && "status" in state) {
        setDesktop((prev) => ({ ...(prev || ({} as DesktopUpdateState)), ...state }));
      }
    });
    return () => dispose?.();
  }, [load]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const api = getElectronApi();
      const tasks: Promise<unknown>[] = [load(true)];
      if (api?.checkForUpdates) {
        tasks.push(
          api
            .checkForUpdates()
            .then((r) => r?.state && setDesktop(r.state))
            .catch(() => {})
        );
      }
      await Promise.all(tasks);
    } finally {
      setChecking(false);
    }
  }, [load]);

  const installDesktopUpdate = useCallback(async () => {
    await getElectronApi()?.installUpdate?.();
  }, []);

  const openUrl = useCallback(async (url: string) => {
    const api = getElectronApi();
    if (api?.openExternal) {
      await api.openExternal(url);
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  return { server, desktop, isDesktop, checking, checkNow, installDesktopUpdate, openUrl };
}
