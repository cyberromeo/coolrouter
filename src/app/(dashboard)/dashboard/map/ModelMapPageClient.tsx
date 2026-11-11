"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import { ConfirmModal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";
import RouteListEditor from "./components/RouteListEditor";
import { TIERS } from "./tierMeta";
import { useModelMap, type SaveStatus } from "./useModelMap";

const MapCanvas = dynamic(() => import("./components/MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="h-[560px] animate-pulse rounded-xl border border-border bg-surface" />
  ),
});

type View = "map" | "list";
const VIEW_STORAGE_KEY = "coolrouter:model-map-view";

function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  const t = useTranslations("modelMap");
  if (status === "idle") return null;
  const content = {
    saving: { icon: "progress_activity", text: t("saving"), cls: "text-text-muted", spin: true },
    saved: { icon: "check_circle", text: t("saved"), cls: "text-success", spin: false },
    error: { icon: "error", text: error || t("saveFailed"), cls: "text-error", spin: false },
  }[status];
  return (
    <span className={cn("flex items-center gap-1.5 text-sm", content.cls)} role="status">
      <span
        className={cn("material-symbols-outlined text-[18px]", content.spin && "animate-spin")}
        aria-hidden="true"
      >
        {content.icon}
      </span>
      {content.text}
    </span>
  );
}

export default function ModelMapPageClient() {
  const t = useTranslations("modelMap");
  const state = useModelMap();
  const { map, models, modelsById, loading, loadError, saveStatus, saveError, setRoute, autoFill } =
    state;
  const [view, setViewState] = useState<View>(() => {
    if (typeof window === "undefined") return "map";
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "map";
  });
  const [confirmRearrange, setConfirmRearrange] = useState(false);
  const [arranging, setArranging] = useState(false);

  const setView = (next: View) => {
    setViewState(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  if (loading) {
    return <div className="h-[560px] animate-pulse rounded-xl border border-border bg-surface" />;
  }

  if (loadError || !map) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-error">{loadError || t("loadFailed")}</p>
        <Button variant="secondary" className="mt-4" onClick={state.reload}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const isEmpty = TIERS.every((tier) => map.routes[tier].models.length === 0);
  const runAutoFill = async (force: boolean) => {
    setArranging(true);
    await autoFill(force);
    setArranging(false);
  };

  if (models.length === 0 && isEmpty) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <span
          className="material-symbols-outlined mb-3 text-[40px] text-text-muted"
          aria-hidden="true"
        >
          account_tree
        </span>
        <h2 className="text-lg font-semibold text-text-main">{t("noProvidersTitle")}</h2>
        <p className="mt-1 max-w-md text-sm text-text-muted">{t("noProvidersBody")}</p>
        <Link href="/dashboard/providers" className="mt-5">
          <Button icon="add">{t("addProvider")}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-sm text-text-muted">{t("intro")}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-[20px]">
          <SaveIndicator status={saveStatus} error={saveError} />
        </div>
        <div className="flex items-center gap-3">
          <div
            role="radiogroup"
            aria-label={t("viewLabel")}
            className="flex rounded-lg border border-border bg-surface p-0.5"
          >
            {(["map", "list"] as View[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={view === option}
                onClick={() => setView(option)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  view === option ? "bg-text-main text-bg" : "text-text-muted hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  {option === "map" ? "account_tree" : "list"}
                </span>
                {t(option === "map" ? "viewMap" : "viewList")}
              </button>
            ))}
          </div>
          {!isEmpty && (
            <Button
              variant="secondary"
              icon="auto_fix_high"
              loading={arranging}
              onClick={() => setConfirmRearrange(true)}
            >
              {t("rearrange")}
            </Button>
          )}
        </div>
      </div>

      {isEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent/5 p-5">
          <div>
            <h2 className="font-semibold text-text-main">{t("arrangeTitle")}</h2>
            <p className="text-sm text-text-muted">{t("arrangeBody", { count: models.length })}</p>
          </div>
          <Button icon="auto_fix_high" loading={arranging} onClick={() => runAutoFill(false)}>
            {t("arrangeAction")}
          </Button>
        </div>
      )}

      {!map.rulesInstalled && !isEmpty && (
        <p className="rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text-muted">
          {t("rulesOffNotice")}
        </p>
      )}

      {map.conflicts.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-text-main">
          <p className="font-medium">{t("conflictsTitle")}</p>
          <ul className="mt-1 list-disc pl-5 text-text-muted">
            {map.conflicts.map((conflict) => (
              <li key={conflict.id}>
                {t("conflictItem", {
                  pattern: conflict.pattern,
                  combo: conflict.comboName || "?",
                })}
              </li>
            ))}
          </ul>
          <Link
            href="/dashboard/combos"
            className="mt-2 inline-flex font-medium text-accent hover:underline"
          >
            {t("conflictsLink")}
          </Link>
        </div>
      )}

      {view === "map" ? (
        <MapCanvas map={map} models={models} modelsById={modelsById} setRoute={setRoute} />
      ) : (
        <RouteListEditor map={map} models={models} modelsById={modelsById} setRoute={setRoute} />
      )}

      <ConfirmModal
        isOpen={confirmRearrange}
        onClose={() => setConfirmRearrange(false)}
        onConfirm={async () => {
          setConfirmRearrange(false);
          await runAutoFill(true);
        }}
        title={t("rearrangeConfirmTitle")}
        message={t("rearrangeConfirmBody")}
        confirmText={t("rearrangeConfirmAction")}
        cancelText={t("cancel")}
        variant="primary"
      />
    </div>
  );
}
