"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useNotificationStore } from "@/store/notificationStore";
import ClientCard from "./ClientCard";
import CopyField from "./CopyField";
import Tutorial, { MenuPath } from "./Tutorial";
import { useLiveDetail, WaitingNotice } from "./LiveHint";
import { postJson, useConnection } from "../useConnection";

const STATUS_URL = "/api/cli-tools/claude-desktop";

interface DesktopConfig {
  inferenceGatewayBaseUrl: string;
  inferenceGatewayApiKey: string;
  inferenceModels: string[];
}

function saveAsDownload(filename: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function ClaudeDesktopCard() {
  const t = useTranslations("connect");
  const notify = useNotificationStore();
  const { info, state, markConnected, showRestartHint } = useConnection(
    STATUS_URL,
    "claude-desktop"
  );
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const liveDetail = useLiveDetail(state, info?.lastSeen, "Claude Desktop");

  const createFile = async (download: boolean) => {
    setBusy(true);
    try {
      const result = await postJson(STATUS_URL, {});
      setConfig(result.config);
      if (download) {
        saveAsDownload(result.filename, result.config);
        notify.success(t("desktop.downloadedToast", { file: result.filename }));
      }
      await markConnected();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientCard
      icon={<ProviderIcon providerId="anthropic" size={24} type="color" />}
      title="Claude Desktop"
      subtitle={t("desktop.subtitle")}
      state={state}
      notDetected={info?.installed === false}
      liveDetail={liveDetail}
      actions={
        <Button
          icon="download"
          variant={info?.connected ? "secondary" : "primary"}
          loading={busy}
          onClick={() => createFile(true)}
        >
          {info?.connected ? t("desktop.downloadAgain") : t("desktop.download")}
        </Button>
      }
      footer={
        state === "waiting" ? (
          <WaitingNotice state={state} showRestartHint={showRestartHint} appName="Claude Desktop" />
        ) : undefined
      }
      howTo={
        <div className="flex flex-col gap-6">
          <Tutorial
            steps={[
              { title: t("desktop.step1Title"), body: t("desktop.step1Body") },
              {
                title: t("desktop.step2Title"),
                body: (
                  <span className="flex flex-col gap-1.5">
                    <MenuPath items={["Help", "Troubleshooting", "Enable Developer Mode"]} />
                    <span>{t("desktop.step2Body")}</span>
                  </span>
                ),
              },
              {
                title: t("desktop.step3Title"),
                body: <MenuPath items={["Developer", "Configure Third-Party Inference…"]} />,
              },
              {
                title: t("desktop.step4Title"),
                body: (
                  <span className="flex flex-col gap-1.5">
                    <span>{t("desktop.step4Body")}</span>
                    <MenuPath items={["Import configuration…", "Apply Changes", "Relaunch now"]} />
                  </span>
                ),
              },
              { title: t("desktop.step5Title"), body: t("desktop.step5Body") },
            ]}
          />

          <div className="rounded-lg border border-border bg-bg/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-text-main">{t("manualTitle")}</h3>
                <p className="text-sm text-text-muted">{t("desktop.manualBody")}</p>
              </div>
              {!config && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => createFile(false)}
                >
                  {t("showValues")}
                </Button>
              )}
            </div>
            {config && (
              <div className="mt-4 grid gap-3">
                <CopyField label={t("desktop.fieldProvider")} value="Gateway" />
                <CopyField
                  label={t("desktop.fieldBaseUrl")}
                  value={config.inferenceGatewayBaseUrl}
                />
                <CopyField
                  label={t("desktop.fieldApiKey")}
                  value={config.inferenceGatewayApiKey}
                  secret
                />
                <CopyField
                  label={t("desktop.fieldModels")}
                  value={config.inferenceModels.join(", ")}
                />
              </div>
            )}
          </div>
          <p className="text-xs text-text-muted">{t("desktop.deleteFileNote")}</p>
        </div>
      }
    />
  );
}
