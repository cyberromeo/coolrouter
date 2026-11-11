"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import { useNotificationStore } from "@/store/notificationStore";
import type { ModelMapTier } from "@/lib/modelMap/tiers";
import ClientCard from "./ClientCard";
import CopyField from "./CopyField";
import Tutorial from "./Tutorial";
import { useLiveDetail, WaitingNotice } from "./LiveHint";
import { postJson, useConnection } from "../useConnection";

const STATUS_URL = "/api/cli-tools/codex-settings";
const ROUTES: ModelMapTier[] = ["sonnet", "opus", "haiku"];

export default function CodexCard() {
  const t = useTranslations("connect");
  const tMap = useTranslations("modelMap");
  const notify = useNotificationStore();
  const { info, state, refresh, markConnected, showRestartHint } = useConnection(
    STATUS_URL,
    "codex"
  );
  const [route, setRoute] = useState<ModelMapTier>("sonnet");
  const [busy, setBusy] = useState<"connect" | "disconnect" | "manual" | null>(null);
  const [snippet, setSnippet] = useState<string | null>(null);
  const liveDetail = useLiveDetail(state, info?.lastSeen, "Codex");

  useEffect(() => {
    if (info?.route && ROUTES.includes(info.route as ModelMapTier)) {
      setRoute(info.route as ModelMapTier);
    }
  }, [info?.route]);

  const connected = Boolean(info?.connected);
  const routeChanged = connected && info?.route && info.route !== route;

  const run = async (kind: "connect" | "manual") => {
    setBusy(kind);
    try {
      const result = await postJson(STATUS_URL, {
        mode: kind === "connect" ? "auto" : "manual",
        route,
      });
      if (kind === "manual") setSnippet(result.snippet);
      else notify.success(t("codex.connectedToast", { path: result.configPath }));
      await markConnected();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await postJson(STATUS_URL, {}, "DELETE");
      setSnippet(null);
      notify.success(t("codex.disconnectedToast"));
      await refresh();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const configPath = info?.configPath || "~/.codex/config.toml";

  return (
    <ClientCard
      icon={<ProviderIcon providerId="codex" size={24} type="color" />}
      title="Codex"
      subtitle={t("codex.subtitle")}
      state={state}
      notDetected={info?.installed === false}
      liveDetail={liveDetail}
      actions={
        <>
          <div
            role="radiogroup"
            aria-label={t("codex.routeLabel")}
            className="flex rounded-lg border border-border bg-bg p-0.5"
          >
            {ROUTES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={route === option}
                onClick={() => setRoute(option)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  route === option ? "bg-text-main text-bg" : "text-text-muted hover:text-text-main"
                )}
              >
                {tMap(`tiers.${option}.name`)}
              </button>
            ))}
          </div>
          {connected ? (
            <>
              {(state === "needs-update" || routeChanged) && (
                <Button icon="sync" loading={busy === "connect"} onClick={() => run("connect")}>
                  {t("update")}
                </Button>
              )}
              <Button variant="ghost" loading={busy === "disconnect"} onClick={disconnect}>
                {t("disconnect")}
              </Button>
            </>
          ) : (
            <Button icon="link" loading={busy === "connect"} onClick={() => run("connect")}>
              {t("connect")}
            </Button>
          )}
        </>
      }
      footer={
        state === "waiting" ? (
          <WaitingNotice state={state} showRestartHint={showRestartHint} appName="Codex" />
        ) : undefined
      }
      howTo={
        <div className="flex flex-col gap-6">
          <Tutorial
            steps={[
              {
                title: t("codex.step1Title"),
                body: t("codex.step1Body", { route: tMap(`tiers.${route}.name`) }),
              },
              {
                title: t("codex.step2Title"),
                body: t("codex.step2Body", { path: configPath }),
              },
              { title: t("codex.step3Title"), body: t("codex.step3Body") },
            ]}
          />
          <div className="rounded-lg border border-border bg-bg/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-text-main">{t("manualTitle")}</h3>
                <p className="text-sm text-text-muted">
                  {t("codex.manualBody", { path: configPath })}
                </p>
              </div>
              {!snippet && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === "manual"}
                  onClick={() => run("manual")}
                >
                  {t("showValues")}
                </Button>
              )}
            </div>
            {snippet && <CopyField className="mt-4" block secret value={snippet} />}
          </div>
        </div>
      }
    />
  );
}
