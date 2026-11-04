"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button } from "@/shared/components";
import { APP_CONFIG } from "@/shared/constants/config";
import { useUpdateStatus } from "@/shared/hooks/useUpdateStatus";

export default function UpdatesCard() {
  const t = useTranslations("updates");
  const { server, desktop, isDesktop, checking, checkNow, installDesktopUpdate, openUrl } =
    useUpdateStatus();
  const [checkedOnce, setCheckedOnce] = useState(false);

  const current = server?.current || desktop?.currentVersion || APP_CONFIG.version;
  const latest = desktop?.version || server?.latest || null;
  const install = isDesktop ? "desktop" : server?.install || "source";
  const releaseUrl = desktop?.releaseUrl || server?.release?.url || server?.releasesUrl || "";
  const updateAvailable =
    !!server?.updateAvailable ||
    desktop?.status === "available" ||
    desktop?.status === "downloading" ||
    desktop?.status === "downloaded";

  const handleCheck = async () => {
    await checkNow();
    setCheckedOnce(true);
  };

  let statusLine: string | null = null;
  if (server?.checkDisabled) statusLine = t("disabled");
  else if (desktop?.status === "downloaded") statusLine = t("readyToInstall", { version: latest });
  else if (desktop?.status === "downloading" && desktop.percent !== null)
    statusLine = t("downloading", { version: latest, percent: desktop.percent });
  else if (updateAvailable && latest) statusLine = t("available", { version: latest });
  else if (server?.error && !server?.latest) statusLine = t("checkFailed");
  else if (server?.latest || checkedOnce) statusLine = t("upToDate");

  const kindLabel =
    install === "docker"
      ? t("kindDocker")
      : install === "desktop"
        ? t("kindDesktop")
        : t("kindSource");

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            system_update_alt
          </span>
        </div>
        <h3 className="text-lg font-semibold">{t("title")}</h3>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-text-muted text-xs">{t("currentVersion")}</p>
            <p className="font-mono font-medium">v{current}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs">{t("latestVersion")}</p>
            <p className="font-mono font-medium">{latest ? `v${latest}` : "—"}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs">{t("installedVia")}</p>
            <p className="font-medium">{kindLabel}</p>
          </div>
        </div>

        {statusLine && (
          <p
            className={
              updateAvailable ? "text-sm font-medium text-primary" : "text-sm text-text-muted"
            }
          >
            {statusLine}
          </p>
        )}

        {updateAvailable && install !== "desktop" && server?.upgradeCommand && (
          <div>
            <p className="text-xs text-text-muted mb-1">{t("upgradeHint")}</p>
            <code className="block text-xs font-mono bg-black/20 dark:bg-white/5 border border-border rounded px-3 py-2 break-all">
              {server.upgradeCommand}
            </code>
          </div>
        )}

        {install === "desktop" && (
          <p className="text-xs text-text-muted">
            {desktop?.strategy === "notify" ? t("desktopNotify") : t("desktopAuto")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            loading={checking}
            disabled={checking || !!server?.checkDisabled}
            onClick={handleCheck}
          >
            {checking ? t("checking") : t("checkNow")}
          </Button>
          {desktop?.status === "downloaded" && (
            <Button size="sm" icon="restart_alt" onClick={() => installDesktopUpdate()}>
              {t("restartToUpdate")}
            </Button>
          )}
          {updateAvailable && desktop?.status !== "downloaded" && releaseUrl && (
            <Button
              variant="ghost"
              size="sm"
              icon="open_in_new"
              onClick={() => openUrl(releaseUrl)}
            >
              {install === "desktop" && desktop?.strategy !== "auto"
                ? t("download")
                : t("releaseNotes")}
            </Button>
          )}
          {!updateAvailable && server?.releasesUrl && (
            <Button
              variant="ghost"
              size="sm"
              icon="open_in_new"
              onClick={() => openUrl(server.releasesUrl)}
            >
              {t("allReleases")}
            </Button>
          )}
        </div>

        {server?.checkedAt && !server.checkDisabled && (
          <p className="text-xs text-text-muted/70">
            {t("lastChecked", { time: new Date(server.checkedAt).toLocaleString() })}
          </p>
        )}
      </div>
    </Card>
  );
}
