"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import type { ModelMapTier } from "@/lib/modelMap/tiers";
import { formatContext, TIER_META, TIERS } from "../tierMeta";
import type { MapModelInfo, ModelMapState } from "../useModelMap";

export const PALETTE_DRAG_TYPE = "application/x-coolrouter-model";

interface ModelPaletteProps {
  models: MapModelInfo[];
  map: ModelMapState;
  /** Below xl the palette is an overlay drawer */
  open: boolean;
  onClose: () => void;
  onAdd: (modelId: string, tier: ModelMapTier) => void;
}

/**
 * "Your models": drag one onto a route, or use the O / S / H buttons to add it
 * to Opus, Sonnet or Haiku without dragging.
 */
export default function ModelPalette({ models, map, open, onClose, onAdd }: ModelPaletteProps) {
  const t = useTranslations("modelMap");
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(needle) ||
            m.name.toLowerCase().includes(needle) ||
            m.providerName.toLowerCase().includes(needle)
        )
      : models;
    const byProvider = new Map<string, MapModelInfo[]>();
    for (const model of filtered) {
      const list = byProvider.get(model.provider) || [];
      list.push(model);
      byProvider.set(model.provider, list);
    }
    return [...byProvider.values()].sort((a, b) =>
      a[0].providerName.localeCompare(b[0].providerName)
    );
  }, [models, query]);

  return (
    <>
      <aside
        aria-label={t("paletteTitle")}
        aria-hidden={!open}
        // Dropping onto the palette itself does nothing.
        onDragOver={(event) => event.stopPropagation()}
        onDrop={(event) => event.stopPropagation()}
        className={cn(
          "absolute bottom-3 right-3 top-3 z-10 flex w-[290px] flex-col rounded-xl border border-border bg-surface shadow-elevated transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-[calc(100%+1rem)]"
        )}
      >
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-main">{t("paletteTitle")}</h3>
            <button
              type="button"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-bg hover:text-text-main"
              aria-label={t("closePalette")}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                close
              </span>
            </button>
          </div>
          <p className="mt-0.5 text-xs text-text-muted">{t("paletteHint")}</p>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModels")}
            className="mt-2.5 h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text-main outline-none focus:border-accent"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-text-muted">{t("noMatches")}</p>
          )}
          {groups.map((list) => (
            <section key={list[0].provider} className="mb-2">
              <h4 className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                <ProviderIcon
                  providerId={list[0].iconId || list[0].provider}
                  size={14}
                  type="color"
                />
                {list[0].providerName}
              </h4>
              <ul>
                {list.map((model) => {
                  const context = formatContext(model.contextLength);
                  return (
                    <li
                      key={model.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(PALETTE_DRAG_TYPE, model.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      className="group flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg active:cursor-grabbing"
                      title={model.id}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text-main">
                          {model.name}
                        </span>
                        {context && (
                          <span className="text-[11px] text-text-muted">
                            {t("contextSize", { size: context })}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 gap-0.5">
                        {TIERS.map((tier) => {
                          const added = map.routes[tier].models.includes(model.id);
                          const name = t(`tiers.${tier}.name`);
                          return (
                            <button
                              key={tier}
                              type="button"
                              disabled={added}
                              onClick={() => onAdd(model.id, tier)}
                              title={
                                added
                                  ? t("alreadyOn", { tier: name })
                                  : t("addModelTo", { tier: name })
                              }
                              aria-label={
                                added
                                  ? t("alreadyOn", { tier: name })
                                  : t("addModelTo", { tier: name })
                              }
                              className={cn(
                                "flex size-6 items-center justify-center rounded-md text-[10px] font-bold transition-colors",
                                added ? "text-white" : "text-text-muted hover:text-white"
                              )}
                              style={{
                                backgroundColor: added ? TIER_META[tier].colorVar : undefined,
                              }}
                              onMouseEnter={(event) => {
                                if (!added)
                                  event.currentTarget.style.backgroundColor =
                                    TIER_META[tier].colorVar;
                              }}
                              onMouseLeave={(event) => {
                                if (!added) event.currentTarget.style.backgroundColor = "";
                              }}
                            >
                              {name[0]}
                            </button>
                          );
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}
