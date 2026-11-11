"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";
import type { ModelMapTier } from "@/lib/modelMap/tiers";
import ModelChip from "./ModelChip";
import ModelPicker from "./ModelPicker";
import { TIER_META, TIERS } from "../tierMeta";
import { moveItem, type MapModelInfo, type ModelMapState } from "../useModelMap";

interface RouteListEditorProps {
  map: ModelMapState;
  models: MapModelInfo[];
  modelsById: Map<string, MapModelInfo>;
  setRoute: (tier: ModelMapTier, models: string[]) => void;
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-black/5 hover:text-text-main disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10"
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

/**
 * The map as three ordered lists. Keyboard- and screen-reader-friendly; the
 * canvas view is built on the same data.
 */
export default function RouteListEditor({
  map,
  models,
  modelsById,
  setRoute,
}: RouteListEditorProps) {
  const t = useTranslations("modelMap");
  const [pickerTier, setPickerTier] = useState<ModelMapTier | null>(null);
  const [dragging, setDragging] = useState<{ tier: ModelMapTier; index: number } | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {TIERS.map((tier) => {
        const route = map.routes[tier];
        const meta = TIER_META[tier];
        const borrowing = route.models.length === 0 && route.servedBy && route.servedBy !== tier;
        return (
          <section
            key={tier}
            aria-labelledby={`route-${tier}-title`}
            className="flex flex-col rounded-xl border border-border bg-surface shadow-soft"
          >
            <header className="flex items-start gap-3 border-b border-border p-4">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: meta.colorVar }}
                aria-hidden="true"
              >
                <span className="material-symbols-outlined text-[20px]">{meta.icon}</span>
              </span>
              <div className="min-w-0">
                <h3 id={`route-${tier}-title`} className="font-semibold text-text-main">
                  {t(`tiers.${tier}.name`)}
                </h3>
                <p className="text-xs text-text-muted">{t(`tiers.${tier}.blurb`)}</p>
              </div>
            </header>

            <ol className="flex flex-1 flex-col gap-1 p-2" aria-label={t("routeOrder")}>
              {route.models.map((modelId, index) => (
                <li
                  key={modelId}
                  draggable
                  onDragStart={() => setDragging({ tier, index })}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => {
                    if (dragging?.tier === tier) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging?.tier !== tier) return;
                    setRoute(tier, moveItem(route.models, dragging.index, index));
                    setDragging(null);
                  }}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-bg",
                    dragging?.tier === tier && dragging.index === index && "opacity-40"
                  )}
                >
                  <span
                    className="material-symbols-outlined cursor-grab text-[18px] text-text-muted/60"
                    aria-hidden="true"
                  >
                    drag_indicator
                  </span>
                  <ModelChip
                    modelId={modelId}
                    info={modelsById.get(modelId)}
                    position={index + 1}
                    className="flex-1"
                  />
                  <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconButton
                      icon="arrow_upward"
                      label={t("moveEarlier")}
                      disabled={index === 0}
                      onClick={() => setRoute(tier, moveItem(route.models, index, index - 1))}
                    />
                    <IconButton
                      icon="arrow_downward"
                      label={t("moveLater")}
                      disabled={index === route.models.length - 1}
                      onClick={() => setRoute(tier, moveItem(route.models, index, index + 1))}
                    />
                    <IconButton
                      icon="close"
                      label={t("removeModel")}
                      onClick={() =>
                        setRoute(
                          tier,
                          route.models.filter((_, i) => i !== index)
                        )
                      }
                    />
                  </div>
                </li>
              ))}
              {route.models.length === 0 && (
                <li className="px-3 py-5 text-center text-sm text-text-muted">
                  {borrowing
                    ? t("emptyRouteBorrowing", {
                        tier: t(`tiers.${route.servedBy}.name`),
                      })
                    : t("emptyRoute")}
                </li>
              )}
            </ol>

            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={() => setPickerTier(tier)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-text-muted transition-colors hover:bg-bg hover:text-text-main"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  add
                </span>
                {t("addModel")}
              </button>
            </div>
          </section>
        );
      })}

      <ModelPicker
        isOpen={pickerTier !== null}
        onClose={() => setPickerTier(null)}
        models={models}
        taken={pickerTier ? map.routes[pickerTier].models : []}
        title={pickerTier ? t("addModelTo", { tier: t(`tiers.${pickerTier}.name`) }) : ""}
        onPick={(modelId) => {
          if (!pickerTier) return;
          setRoute(pickerTier, [...map.routes[pickerTier].models, modelId]);
        }}
      />
    </div>
  );
}
