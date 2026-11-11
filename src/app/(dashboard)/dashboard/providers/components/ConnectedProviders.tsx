"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";
import { useNotificationStore } from "@/store/notificationStore";

export interface ConnectionRow {
  id: string;
  provider: string;
  name?: string;
  isActive?: boolean;
  testStatus?: string;
  lastError?: string | null;
}

export interface ProviderGroup {
  providerId: string;
  displayName: string;
  iconId: string;
  connections: ConnectionRow[];
  modelCount: number | null;
}

interface ConnectedProvidersProps {
  groups: ProviderGroup[];
  onChanged: () => void;
}

const HEALTHY = new Set(["active", "success", "unknown"]);

function statusOf(group: ProviderGroup): "ok" | "error" | "off" {
  const active = group.connections.filter((c) => c.isActive !== false);
  if (active.length === 0) return "off";
  return active.some((c) => HEALTHY.has(String(c.testStatus || "unknown"))) ? "ok" : "error";
}

async function call(url: string, method: "POST" | "DELETE") {
  const response = await fetch(url, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? "{}" : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data?.error;
    throw new Error(
      typeof error === "string" ? error : error?.message || `HTTP ${response.status}`
    );
  }
  return data;
}

/** One row per connected provider, with the few actions most people need. */
export default function ConnectedProviders({ groups, onChanged }: ConnectedProvidersProps) {
  const t = useTranslations("providerGallery");
  const notify = useNotificationStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProviderGroup | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const test = (group: ProviderGroup) =>
    run(`test:${group.providerId}`, async () => {
      const results = await Promise.all(
        group.connections.map((c) => call(`/api/providers/${c.id}/test`, "POST"))
      );
      const ok = results.some((r) => r?.valid);
      if (ok) notify.success(t("testOk", { provider: group.displayName }));
      else notify.error(results[0]?.error || t("testFailed", { provider: group.displayName }));
      onChanged();
    });

  const refresh = (group: ProviderGroup) =>
    run(`refresh:${group.providerId}`, async () => {
      const result = await call(`/api/providers/${group.connections[0].id}/sync-models`, "POST");
      const count = Array.isArray(result?.models) ? result.models.length : 0;
      notify.success(t("refreshOk", { count }));
      onChanged();
    });

  const remove = (group: ProviderGroup) =>
    run(`remove:${group.providerId}`, async () => {
      for (const connection of group.connections) {
        await call(`/api/providers/${connection.id}`, "DELETE");
      }
      notify.success(t("removed", { provider: group.displayName }));
      setRemoving(null);
      onChanged();
    });

  return (
    <>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
        {groups.map((group) => {
          const status = statusOf(group);
          return (
            <li key={group.providerId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg">
                <ProviderIcon providerId={group.iconId} size={22} type="color" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/providers/${group.providerId}`}
                    className="truncate text-sm font-medium text-text-main hover:underline"
                  >
                    {group.displayName}
                  </Link>
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      status === "ok"
                        ? "bg-success"
                        : status === "error"
                          ? "bg-error"
                          : "bg-text-muted/40"
                    )}
                    title={t(`status.${status}`)}
                    aria-label={t(`status.${status}`)}
                  />
                </div>
                <p className="text-xs text-text-muted">
                  {group.modelCount !== null
                    ? t("modelCount", { count: group.modelCount })
                    : t("modelCountUnknown")}
                  {group.connections.length > 1 &&
                    ` · ${t("accountCount", { count: group.connections.length })}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => test(group)}
                  disabled={busy !== null}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg hover:text-text-main disabled:opacity-50"
                >
                  {busy === `test:${group.providerId}` ? t("testing") : t("test")}
                </button>
                <button
                  type="button"
                  onClick={() => refresh(group)}
                  disabled={busy !== null}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg hover:text-text-main disabled:opacity-50"
                >
                  {busy === `refresh:${group.providerId}` ? t("refreshing") : t("refreshModels")}
                </button>
                <Link
                  href={`/dashboard/providers/${group.providerId}`}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg hover:text-text-main"
                >
                  {t("details")}
                </Link>
                <button
                  type="button"
                  onClick={() => setRemoving(group)}
                  disabled={busy !== null}
                  title={t("remove")}
                  aria-label={t("remove")}
                  className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    delete
                  </span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
        title={t("removeTitle", { provider: removing?.displayName ?? "" })}
        message={t("removeBody")}
        confirmText={t("remove")}
        cancelText={t("cancel")}
        loading={busy?.startsWith("remove:")}
      />
    </>
  );
}
