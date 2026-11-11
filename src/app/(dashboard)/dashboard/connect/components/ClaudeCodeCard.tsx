"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useNotificationStore } from "@/store/notificationStore";
import ClientCard from "./ClientCard";
import CopyField from "./CopyField";
import Tutorial from "./Tutorial";
import { useLiveDetail, WaitingNotice } from "./LiveHint";
import { postJson, useConnection } from "../useConnection";

const STATUS_URL = "/api/cli-tools/claude-settings";

function shellExports(env: Record<string, string>, shell: "bash" | "powershell") {
  return Object.entries(env)
    .map(([key, value]) =>
      shell === "bash"
        ? `export ${key}=${JSON.stringify(value)}`
        : `$env:${key} = ${JSON.stringify(value)}`
    )
    .join("\n");
}

export default function ClaudeCodeCard() {
  const t = useTranslations("connect");
  const notify = useNotificationStore();
  const { info, state, refresh, markConnected, showRestartHint } = useConnection(
    STATUS_URL,
    "claude-code"
  );
  const [busy, setBusy] = useState<"connect" | "disconnect" | "manual" | null>(null);
  const [manualEnv, setManualEnv] = useState<Record<string, string> | null>(null);
  const [shell, setShell] = useState<"json" | "bash" | "powershell">("json");
  const liveDetail = useLiveDetail(state, info?.lastSeen, "Claude Code");

  const connected = Boolean(info?.connected);
  const connect = async () => {
    setBusy("connect");
    try {
      const result = await postJson(STATUS_URL, { mode: "auto" });
      notify.success(t("claudeCode.connectedToast", { path: result.settingsPath }));
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
      setManualEnv(null);
      notify.success(t("claudeCode.disconnectedToast"));
      await refresh();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  const showManual = async () => {
    setBusy("manual");
    try {
      const result = await postJson(STATUS_URL, { mode: "manual" });
      setManualEnv(result.env);
      await markConnected();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const settingsPath = info?.settingsPath || "~/.claude/settings.json";
  const baseUrl = info?.baseUrl || "http://127.0.0.1:20128";

  return (
    <ClientCard
      icon={<ProviderIcon providerId="claude" size={26} type="color" />}
      title="Claude Code"
      subtitle={t("claudeCode.subtitle")}
      state={state}
      notDetected={info?.installed === false}
      liveDetail={liveDetail}
      actions={
        connected ? (
          <>
            {state === "needs-update" && (
              <Button icon="sync" loading={busy === "connect"} onClick={connect}>
                {t("update")}
              </Button>
            )}
            <Button variant="ghost" loading={busy === "disconnect"} onClick={disconnect}>
              {t("disconnect")}
            </Button>
          </>
        ) : (
          <Button icon="link" loading={busy === "connect"} onClick={connect}>
            {t("connect")}
          </Button>
        )
      }
      footer={
        state === "waiting" ? (
          <WaitingNotice state={state} showRestartHint={showRestartHint} appName="Claude Code" />
        ) : undefined
      }
      howTo={
        <div className="flex flex-col gap-6">
          <Tutorial
            steps={[
              {
                title: t("claudeCode.step1Title"),
                body: t("claudeCode.step1Body", { path: settingsPath }),
              },
              { title: t("claudeCode.step2Title"), body: t("claudeCode.step2Body") },
              {
                title: t("claudeCode.step3Title"),
                body: (
                  <span>
                    {t("claudeCode.step3Body")}{" "}
                    <code className="rounded bg-bg px-1 font-mono text-xs text-text-main">
                      Anthropic base URL: {baseUrl}
                    </code>
                  </span>
                ),
              },
              { title: t("claudeCode.step4Title"), body: t("claudeCode.step4Body") },
            ]}
          />

          <div className="rounded-lg border border-border bg-bg/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-text-main">{t("manualTitle")}</h3>
                <p className="text-sm text-text-muted">{t("claudeCode.manualBody")}</p>
              </div>
              {!manualEnv && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === "manual"}
                  onClick={showManual}
                >
                  {t("showValues")}
                </Button>
              )}
            </div>
            {manualEnv && (
              <div className="mt-4 flex flex-col gap-3">
                <div
                  role="radiogroup"
                  aria-label={t("format")}
                  className="flex w-fit rounded-lg border border-border bg-surface p-0.5"
                >
                  {(["json", "bash", "powershell"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={shell === option}
                      onClick={() => setShell(option)}
                      className={
                        shell === option
                          ? "rounded-md bg-text-main px-2.5 py-1 text-xs font-medium text-bg"
                          : "rounded-md px-2.5 py-1 text-xs font-medium text-text-muted hover:text-text-main"
                      }
                    >
                      {t(`formats.${option}`)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted">
                  {shell === "json"
                    ? t("claudeCode.jsonHint", { path: settingsPath })
                    : t("claudeCode.shellHint")}
                </p>
                <CopyField
                  block
                  secret
                  value={
                    shell === "json"
                      ? JSON.stringify({ env: manualEnv }, null, 2)
                      : shellExports(manualEnv, shell)
                  }
                />
              </div>
            )}
          </div>
        </div>
      }
    />
  );
}
