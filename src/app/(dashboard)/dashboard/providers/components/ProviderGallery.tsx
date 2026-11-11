"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS } from "@/shared/constants/providers";
import { LOCAL_SERVERS } from "@/shared/constants/localServers";
import {
  buildGallery,
  GALLERY_TABS,
  searchGallery,
  type CatalogEntry,
  type GalleryProvider,
  type GalleryTab,
} from "../providerGallery";
import type { ConnectTarget } from "./ConnectProviderDialog";

interface ProviderGalleryProps {
  connectedIds: Set<string>;
  onPick: (target: ConnectTarget) => void;
}

const TAB_ICONS: Record<GalleryTab, string> = {
  pay: "key",
  subscription: "card_membership",
  free: "redeem",
  local: "computer",
  custom: "add_link",
};

function Tile({
  icon,
  name,
  badge,
  connected,
  onClick,
  href,
}: {
  icon: string;
  name: string;
  badge?: string | null;
  connected?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const t = useTranslations("providerGallery");
  const className =
    "group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-all hover:-translate-y-px hover:border-black/20 hover:shadow-warm dark:hover:border-white/25";
  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg">
        <ProviderIcon providerId={icon} size={22} type="color" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-main">{name}</span>
        {(badge || connected) && (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs">
            {connected && <span className="text-success">{t("connectedBadge")}</span>}
            {badge && !connected && <span className="text-text-muted">{badge}</span>}
          </span>
        )}
      </span>
      <span
        className="material-symbols-outlined text-[18px] text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      >
        add
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/** Every provider, grouped by how you pay for it, with search. */
export default function ProviderGallery({ connectedIds, onPick }: ProviderGalleryProps) {
  const t = useTranslations("providerGallery");
  const [tab, setTab] = useState<GalleryTab>("pay");
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () =>
      buildGallery({
        apiKey: APIKEY_PROVIDERS as unknown as Record<string, CatalogEntry>,
        oauth: OAUTH_PROVIDERS as unknown as Record<string, CatalogEntry>,
        free: FREE_PROVIDERS as unknown as Record<string, CatalogEntry>,
      }),
    []
  );

  const infoFor = (id: string) =>
    (OAUTH_PROVIDERS[id] || FREE_PROVIDERS[id] || APIKEY_PROVIDERS[id]) as Record<string, unknown>;

  const searching = query.trim().length > 0;
  const searchResults = searching
    ? searchGallery(
        [...groups.pay, ...groups.subscription, ...groups.free].filter(
          (p, index, list) => list.findIndex((other) => other.id === p.id) === index
        ),
        query
      )
    : [];

  const renderProvider = (provider: GalleryProvider) => {
    const badge = provider.hasFree ? t("freeBadge") : null;
    if (provider.kind === "details") {
      return (
        <Tile
          key={provider.id}
          icon={provider.id}
          name={provider.name}
          badge={badge}
          connected={connectedIds.has(provider.id)}
          href={`/dashboard/providers/${provider.id}`}
        />
      );
    }
    return (
      <Tile
        key={provider.id}
        icon={provider.id}
        name={provider.name}
        badge={badge}
        connected={connectedIds.has(provider.id)}
        onClick={() =>
          onPick({
            kind: provider.kind === "oauth" ? "oauth" : "apikey",
            provider,
            info: infoFor(provider.id),
          })
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={t("tabsLabel")}
          className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1"
        >
          {GALLERY_TABS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={!searching && tab === option}
              onClick={() => {
                setTab(option);
                setQuery("");
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                !searching && tab === option
                  ? "bg-text-main text-bg"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {TAB_ICONS[option]}
              </span>
              {t(`tabs.${option}`)}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full max-w-xs">
          <span className="sr-only">{t("search")}</span>
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted"
            aria-hidden="true"
          >
            search
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text-main outline-none focus:border-accent"
          />
        </label>
      </div>

      {!searching && <p className="text-sm text-text-muted">{t(`tabBlurbs.${tab}`)}</p>}

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {searching && searchResults.map(renderProvider)}
        {searching && searchResults.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-text-muted">{t("noResults")}</p>
        )}
        {!searching && tab === "pay" && groups.pay.map(renderProvider)}
        {!searching && tab === "subscription" && groups.subscription.map(renderProvider)}
        {!searching && tab === "free" && groups.free.map(renderProvider)}
        {!searching &&
          tab === "local" &&
          LOCAL_SERVERS.map((server) => (
            <Tile
              key={server.id}
              icon={server.icon}
              name={server.name}
              badge={t("localBadge", { port: server.port })}
              onClick={() => onPick({ kind: "local", server })}
            />
          ))}
        {!searching && tab === "custom" && (
          <>
            <Tile
              icon="oai-cc"
              name={t("customOpenAITitle")}
              badge={t("customOpenAIBadge")}
              onClick={() => onPick({ kind: "custom", api: "openai" })}
            />
            <Tile
              icon="anthropic-m"
              name={t("customAnthropicTitle")}
              badge={t("customAnthropicBadge")}
              onClick={() => onPick({ kind: "custom", api: "anthropic" })}
            />
          </>
        )}
      </div>
    </div>
  );
}
