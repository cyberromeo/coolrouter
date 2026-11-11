"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Modal from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import { formatContext } from "../tierMeta";
import type { MapModelInfo } from "../useModelMap";

interface ModelPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (modelId: string) => void;
  models: MapModelInfo[];
  /** Models already on the route (shown as added) */
  taken: string[];
  title: string;
}

/** Searchable list of every connected model, grouped by provider. */
export default function ModelPicker({
  isOpen,
  onClose,
  onPick,
  models,
  taken,
  title,
}: ModelPickerProps) {
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
    return [...byProvider.entries()].sort((a, b) =>
      a[1][0].providerName.localeCompare(b[1][0].providerName)
    );
  }, [models, query]);

  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={title} size="lg">
      {models.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-text-muted">{t("noModelsYet")}</p>
          <Link
            href="/dashboard/providers"
            className="mt-3 inline-flex text-sm font-medium text-accent hover:underline"
          >
            {t("addProviderLink")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="relative block">
            <span className="sr-only">{t("searchModels")}</span>
            <span
              className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted"
              aria-hidden="true"
            >
              search
            </span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchModels")}
              className="h-10 w-full rounded-lg border border-border bg-bg pl-9 pr-3 text-sm text-text-main outline-none focus:border-accent"
            />
          </label>
          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {groups.length === 0 && (
              <p className="py-6 text-center text-sm text-text-muted">{t("noMatches")}</p>
            )}
            {groups.map(([provider, list]) => (
              <section key={provider} className="mb-3">
                <h4 className="sticky top-0 z-10 flex items-center gap-2 bg-surface py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <ProviderIcon providerId={list[0].iconId || provider} size={16} type="color" />
                  {list[0].providerName}
                </h4>
                <ul className="flex flex-col">
                  {list.map((model) => {
                    const added = taken.includes(model.id);
                    const context = formatContext(model.contextLength);
                    return (
                      <li key={model.id}>
                        <button
                          type="button"
                          disabled={added}
                          onClick={() => {
                            onPick(model.id);
                            close();
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                            added
                              ? "cursor-default opacity-50"
                              : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-text-main">
                              {model.name}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-text-muted">
                              {model.id}
                            </span>
                          </span>
                          {model.toolCalling === false && (
                            <span className="text-[11px] text-warning">{t("noTools")}</span>
                          )}
                          {context && (
                            <span className="rounded-md bg-bg px-1.5 py-0.5 text-[11px] text-text-muted">
                              {context}
                            </span>
                          )}
                          <span
                            className="material-symbols-outlined text-[18px] text-text-muted"
                            aria-hidden="true"
                          >
                            {added ? "check" : "add"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
