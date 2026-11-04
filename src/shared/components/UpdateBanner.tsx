"use client";

/**
 * Update banner — shows "Cool Router X.Y.Z is available" at the top of the dashboard.
 *
 * Web / Docker / source installs: driven by GET /api/system/version (GitHub releases,
 * cached server-side for ~6h) and shows the matching upgrade command.
 * Desktop app: driven by the Electron updater state (download progress, "Restart to update",
 * or a download link on macOS / .deb where the app can't install updates itself).
 *
 * Dismissal is remembered per version in localStorage.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUpdateStatus } from "@/shared/hooks/useUpdateStatus";

const DISMISS_KEY = "coolrouter-update-dismissed";

export default function UpdateBanner() {
  const t = useTranslations("updates");
  const { server, desktop, isDesktop, installDesktopUpdate, openUrl } = useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });
  const [copied, setCopied] = useState(false);

  // Work out what (if anything) to show.
  let version: string | null = null;
  let mode: "downloaded" | "downloading" | "download" | "command" | null = null;
  let releaseUrl = server?.release?.url || server?.releasesUrl || "";
  let percent: number | null = null;

  if (isDesktop && desktop && desktop.version) {
    if (desktop.status === "downloaded") mode = "downloaded";
    else if (desktop.status === "downloading") mode = "downloading";
    else if (desktop.status === "available") mode = "download";
    if (mode) {
      version = desktop.version;
      releaseUrl = desktop.releaseUrl || releaseUrl;
      percent = desktop.percent;
    }
  }
  if (!mode && server?.updateAvailable && server.latest) {
    version = server.latest;
    if (server.install === "desktop" || isDesktop) {
      // Auto-updating desktop builds download on their own; others get a link.
      mode = desktop?.strategy === "auto" ? "downloading" : "download";
    } else {
      mode = "command";
    }
  }

  if (!mode || !version) return null;
  // A ready-to-install update can't be dismissed away silently; everything else can.
  if (mode !== "downloaded" && dismissed === version) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, version as string);
    } catch {
      /* ignore */
    }
    setDismissed(version);
  };

  const command = server?.upgradeCommand || null;
  const copyCommand = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div
      role="status"
      className="border-b border-primary/20 bg-primary/5 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
        <span className="material-symbols-outlined text-primary text-[18px]" aria-hidden="true">
          {mode === "downloaded" ? "restart_alt" : "system_update_alt"}
        </span>
        <span className="text-sm text-text-main font-medium">
          {mode === "downloaded"
            ? t("readyToInstall", { version })
            : mode === "downloading" && percent !== null
              ? t("downloading", { version, percent })
              : t("available", { version })}
        </span>
        {server?.current && (
          <span className="text-xs text-text-muted">
            {t("youHave", { current: server.current })}
          </span>
        )}
        {mode === "command" && command && (
          <span className="flex items-center gap-1.5 min-w-0">
            <code className="text-xs font-mono bg-black/20 dark:bg-white/5 border border-border rounded px-2 py-0.5 truncate max-w-[28rem]">
              {command}
            </code>
            <button
              type="button"
              onClick={copyCommand}
              className="text-xs text-text-muted hover:text-text-main"
            >
              {copied ? t("copied") : t("copy")}
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {releaseUrl && (
          <button
            type="button"
            onClick={() => openUrl(releaseUrl)}
            className="text-xs font-medium text-text-muted hover:text-text-main underline-offset-2 hover:underline"
          >
            {t("releaseNotes")}
          </button>
        )}
        {mode === "downloaded" && (
          <button
            type="button"
            onClick={() => installDesktopUpdate()}
            className="h-7 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {t("restartToUpdate")}
          </button>
        )}
        {mode === "download" && (
          <button
            type="button"
            onClick={() => openUrl(releaseUrl)}
            className="h-7 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {t("download")}
          </button>
        )}
        {mode !== "downloaded" && (
          <button
            type="button"
            onClick={dismiss}
            className="p-1 rounded hover:bg-white/5 text-text-muted hover:text-text-main transition-colors"
            aria-label={t("dismiss")}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>
    </div>
  );
}
