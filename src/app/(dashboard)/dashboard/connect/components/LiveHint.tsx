"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ClientState } from "./ClientCard";
import type { LastSeen } from "../useConnection";

/** Line under a card: who answered the last message, or what to do while waiting. */
export function useLiveDetail(
  state: ClientState,
  lastSeen: LastSeen | null | undefined,
  appName: string
): string | null {
  const t = useTranslations("connect");
  const format = useFormatter();
  if (state !== "live" || !lastSeen) return null;
  const when = format.relativeTime(new Date(lastSeen.timestamp));
  const model = lastSeen.model ? lastSeen.model.split("/").pop() : null;
  return model ? t("liveDetail", { when, model }) : t("liveDetailNoModel", { when, app: appName });
}

export function WaitingNotice({
  state,
  showRestartHint,
  appName,
}: {
  state: ClientState;
  showRestartHint: boolean;
  appName: string;
}) {
  const t = useTranslations("connect");
  if (state !== "waiting") return null;
  return (
    <div className="flex items-start gap-2 text-sm text-text-muted" role="status">
      <span
        className="material-symbols-outlined mt-0.5 animate-pulse text-[18px] text-warning"
        aria-hidden="true"
      >
        podcasts
      </span>
      <span>
        {t("waitingBody", { app: appName })}
        {showRestartHint && <> {t("restartHint", { app: appName })}</>}
      </span>
    </div>
  );
}
