"use client";

import { useTranslations } from "next-intl";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import { MIN_CLAUDE_CODE_CONTEXT } from "@/lib/modelMap/tiers";
import { formatContext } from "../tierMeta";
import type { MapModelInfo } from "../useModelMap";

interface ModelChipProps {
  modelId: string;
  info?: MapModelInfo;
  /** 1-based position on its route; shown as ① ② ③ */
  position?: number;
  compact?: boolean;
  className?: string;
}

/** A model as the map shows it: provider logo, name, provider, context size, warnings. */
export default function ModelChip({ modelId, info, position, compact, className }: ModelChipProps) {
  const t = useTranslations("modelMap");
  const provider = info?.provider || modelId.split("/")[0];
  const iconId = info?.iconId || provider;
  const name = info?.name || modelId.split("/").slice(1).join("/");
  const context = formatContext(info?.contextLength);
  const tooSmall =
    typeof info?.contextLength === "number" && info.contextLength < MIN_CLAUDE_CODE_CONTEXT;
  const missing = !info;

  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", className)}>
      {typeof position === "number" && (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-text-main text-[11px] font-semibold text-bg"
          aria-label={t("position", { position })}
        >
          {position}
        </span>
      )}
      <ProviderIcon providerId={iconId} size={compact ? 18 : 22} type="color" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-main" title={modelId}>
          {name}
        </div>
        {!compact && (
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="truncate">{info?.providerName || provider}</span>
            {context && <span aria-hidden="true">·</span>}
            {context && <span>{t("contextSize", { size: context })}</span>}
          </div>
        )}
      </div>
      {missing && (
        <span
          className="material-symbols-outlined text-[18px] text-warning"
          title={t("modelUnavailable")}
          aria-label={t("modelUnavailable")}
        >
          link_off
        </span>
      )}
      {!missing && tooSmall && (
        <span
          className="material-symbols-outlined text-[18px] text-warning"
          title={t("contextTooSmall")}
          aria-label={t("contextTooSmall")}
        >
          warning
        </span>
      )}
    </div>
  );
}
