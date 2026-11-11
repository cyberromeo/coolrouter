"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";

export type ClientState = "loading" | "not-connected" | "waiting" | "live" | "needs-update";

interface ClientCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  state: ClientState;
  /** Not installed on this computer (shown as a hint, never blocks) */
  notDetected?: boolean;
  liveDetail?: string | null;
  actions: ReactNode;
  /** The tutorial and manual setup, folded away until asked for */
  howTo: ReactNode;
  footer?: ReactNode;
  defaultOpen?: boolean;
}

function StatePill({ state }: { state: ClientState }) {
  const t = useTranslations("connect");
  const config: Record<ClientState, { text: string; icon: string; cls: string; spin?: boolean }> = {
    loading: { text: t("checking"), icon: "progress_activity", cls: "text-text-muted", spin: true },
    "not-connected": {
      text: t("notConnected"),
      icon: "radio_button_unchecked",
      cls: "text-text-muted",
    },
    waiting: { text: t("waiting"), icon: "hourglass_top", cls: "text-warning" },
    live: { text: t("live"), icon: "check_circle", cls: "text-success" },
    "needs-update": { text: t("needsUpdate"), icon: "sync_problem", cls: "text-warning" },
  };
  const item = config[state];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", item.cls)}>
      <span
        className={cn("material-symbols-outlined text-[16px]", item.spin && "animate-spin")}
        aria-hidden="true"
      >
        {item.icon}
      </span>
      {item.text}
    </span>
  );
}

/** One app on the Connect page: status, the main action, and "Show me how". */
export default function ClientCard({
  icon,
  title,
  subtitle,
  state,
  notDetected,
  liveDetail,
  actions,
  howTo,
  footer,
  defaultOpen = false,
}: ClientCardProps) {
  const t = useTranslations("connect");
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface shadow-soft">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-bg">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold text-text-main">{title}</h2>
            <StatePill state={state} />
          </div>
          <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
          {liveDetail && state === "live" && (
            <p className="mt-1 text-xs text-text-muted">{liveDetail}</p>
          )}
          {notDetected && state === "not-connected" && (
            <p className="mt-1 text-xs text-text-muted">{t("notDetected")}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 border-t border-border px-5 py-3 text-left text-sm font-medium text-text-muted transition-colors hover:text-text-main"
      >
        <span
          className={cn(
            "material-symbols-outlined text-[18px] transition-transform",
            open && "rotate-90"
          )}
          aria-hidden="true"
        >
          chevron_right
        </span>
        {t("showMeHow")}
      </button>
      {open && <div className="border-t border-border px-5 py-5">{howTo}</div>}
      {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
    </section>
  );
}
