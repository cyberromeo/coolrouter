"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import { copyToClipboard } from "@/shared/utils/clipboard";
import { TIER_META, TIERS } from "./map/tierMeta";

// Used for the server render only when the request's own origin could not be determined.
const FALLBACK_ORIGIN = "http://localhost:20128";

// The page origin never changes while the page is open, so there is nothing to subscribe to.
const subscribeToNothing = () => () => {};
const getBrowserOrigin = () => window.location.origin;

type AppStatus = { connected: boolean; needsUpdate?: boolean; keyRevoked?: boolean } | null;

interface HomeState {
  providers: number | null;
  routes: Record<string, { first: string | null; count: number }> | null;
  apps: { claudeCode: AppStatus; claudeDesktop: AppStatus; codex: AppStatus };
  requests: number | null;
  tokens: number | null;
}

async function getJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatNumber(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("home");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        // copyToClipboard falls back to execCommand on plain-HTTP (LAN / Docker) origins.
        if (await copyToClipboard(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-muted transition-colors hover:text-text-main"
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? t("copied") : t("copy")}
    </button>
  );
}

interface StepCardProps {
  number: number;
  title: string;
  done: boolean;
  current: boolean;
  summary: ReactNode;
  href: string;
  action: string;
}

function StepCard({ number, title, done, current, summary, href, action }: StepCardProps) {
  const t = useTranslations("home");
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-surface p-5 shadow-soft transition-colors",
        current ? "border-accent/60 ring-1 ring-accent/30" : "border-border"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-full text-sm font-semibold",
            done
              ? "bg-success/15 text-success"
              : current
                ? "bg-accent text-white"
                : "bg-bg text-text-muted"
          )}
          aria-hidden="true"
        >
          {done ? <span className="material-symbols-outlined text-[18px]">check</span> : number}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {t("step", { number })}
          </p>
          <h2 className="font-semibold text-text-main">{title}</h2>
        </div>
      </div>
      <div className="mt-4 min-h-[56px] flex-1 text-sm text-text-muted">{summary}</div>
      <Link href={href} className="mt-4">
        <Button variant={current ? "primary" : "secondary"} fullWidth iconRight="arrow_forward">
          {action}
        </Button>
      </Link>
    </div>
  );
}

function AppLine({ label, icon, status }: { label: string; icon: string; status: AppStatus }) {
  const t = useTranslations("home");
  const needsAttention = status?.connected && (status.needsUpdate || status.keyRevoked);
  return (
    <span className="flex items-center gap-2">
      <ProviderIcon providerId={icon} size={16} type="color" />
      <span className="text-text-main">{label}</span>
      <span
        className={cn(
          "ml-auto text-xs",
          needsAttention ? "text-warning" : status?.connected ? "text-success" : "text-text-muted"
        )}
      >
        {needsAttention ? t("appNeedsUpdate") : status?.connected ? t("appConnected") : "—"}
      </span>
    </span>
  );
}

export default function HomePageClient({
  initialOrigin,
}: {
  machineId?: string;
  /** Origin of the incoming request, resolved on the server. */
  initialOrigin?: string;
}) {
  const t = useTranslations("home");
  const tMap = useTranslations("modelMap");
  // Hydrate with the value the server rendered, then switch to the browser's origin.
  const origin = useSyncExternalStore(
    subscribeToNothing,
    getBrowserOrigin,
    () => initialOrigin || FALLBACK_ORIGIN
  );
  const [state, setState] = useState<HomeState | null>(null);

  useEffect(() => {
    Promise.all([
      getJson("/api/providers"),
      getJson("/api/model-map"),
      getJson("/api/cli-tools/claude-settings"),
      getJson("/api/cli-tools/claude-desktop"),
      getJson("/api/cli-tools/codex-settings"),
      getJson("/api/usage/analytics?range=24h"),
    ]).then(([providers, modelMap, claudeCode, claudeDesktop, codex, usage]) => {
      const models = new Map<string, string>(
        (Array.isArray(modelMap?.models) ? modelMap.models : []).map(
          (m: { id: string; name: string }) => [m.id, m.name]
        )
      );
      const routes = modelMap?.map?.routes
        ? Object.fromEntries(
            TIERS.map((tier) => {
              const ids: string[] = modelMap.map.routes[tier]?.models ?? [];
              return [
                tier,
                {
                  first: ids[0] ? models.get(ids[0]) || ids[0].split("/").pop() || null : null,
                  count: ids.length,
                },
              ];
            })
          )
        : null;
      setState({
        providers: Array.isArray(providers?.connections) ? providers.connections.length : null,
        routes,
        apps: { claudeCode, claudeDesktop, codex },
        requests: usage?.summary?.totalRequests ?? null,
        tokens: usage?.summary?.totalTokens ?? null,
      });
    });
  }, []);

  const providersDone = (state?.providers ?? 0) > 0;
  const mapDone = Boolean(state?.routes && TIERS.some((tier) => state.routes[tier].count > 0));
  const apps = state?.apps;
  const connectedApps = apps
    ? [apps.claudeCode, apps.claudeDesktop, apps.codex].filter((a) => a?.connected).length
    : 0;
  const appsDone = connectedApps > 0;
  const needsUpdate = apps
    ? [apps.claudeCode, apps.claudeDesktop, apps.codex].some(
        (a) => a?.connected && (a.needsUpdate || a.keyRevoked)
      )
    : false;
  const currentStep = !providersDone ? 1 : !mapDone ? 2 : !appsDone ? 3 : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-main">
          {currentStep === 0 ? t("allSetTitle") : t("welcomeTitle")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {currentStep === 0 ? t("allSetBody") : t("welcomeBody")}
        </p>
      </div>

      {needsUpdate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
          <p className="text-sm text-text-main">{t("needsUpdateBanner")}</p>
          <Link
            href="/dashboard/connect"
            className="text-sm font-medium text-accent hover:underline"
          >
            {t("needsUpdateAction")}
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <StepCard
          number={1}
          title={t("step1Title")}
          done={providersDone}
          current={currentStep === 1}
          href="/dashboard/providers"
          action={providersDone ? t("step1Manage") : t("step1Action")}
          summary={
            state === null
              ? t("loading")
              : providersDone
                ? t("step1Done", { count: state.providers ?? 0 })
                : t("step1Empty")
          }
        />
        <StepCard
          number={2}
          title={t("step2Title")}
          done={mapDone}
          current={currentStep === 2}
          href="/dashboard/map"
          action={mapDone ? t("step2Manage") : t("step2Action")}
          summary={
            mapDone && state?.routes ? (
              <ul className="flex flex-col gap-1.5">
                {TIERS.map((tier) => (
                  <li key={tier} className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: TIER_META[tier].colorVar }}
                      aria-hidden="true"
                    />
                    <span className="w-16 shrink-0 text-text-main">
                      {tMap(`tiers.${tier}.name`)}
                    </span>
                    <span className="truncate">{state.routes[tier].first ?? t("borrowed")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              t("step2Empty")
            )
          }
        />
        <StepCard
          number={3}
          title={t("step3Title")}
          done={appsDone}
          current={currentStep === 3}
          href="/dashboard/connect"
          action={appsDone ? t("step3Manage") : t("step3Action")}
          summary={
            <span className="flex flex-col gap-1.5">
              <AppLine label="Claude Code" icon="claude" status={apps?.claudeCode ?? null} />
              <AppLine
                label="Claude Desktop"
                icon="anthropic"
                status={apps?.claudeDesktop ?? null}
              />
              <AppLine label="Codex" icon="codex" status={apps?.codex ?? null} />
            </span>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {t("endpointTitle")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-bg px-3 py-2 font-mono text-sm text-text-main">
              {origin}/v1
            </code>
            <CopyButton value={`${origin}/v1`} />
          </div>
          <p className="mt-2 text-xs text-text-muted">{t("endpointHint")}</p>
        </div>
        <Link
          href="/dashboard/analytics"
          className="rounded-xl border border-border bg-surface p-5 shadow-soft transition-colors hover:border-black/20 dark:hover:border-white/25"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {t("requests24h")}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-text-main">
            {formatNumber(state?.requests ?? null)}
          </p>
        </Link>
        <Link
          href="/dashboard/analytics"
          className="rounded-xl border border-border bg-surface p-5 shadow-soft transition-colors hover:border-black/20 dark:hover:border-white/25"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {t("tokens24h")}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-text-main">
            {formatNumber(state?.tokens ?? null)}
          </p>
        </Link>
      </div>
    </div>
  );
}
