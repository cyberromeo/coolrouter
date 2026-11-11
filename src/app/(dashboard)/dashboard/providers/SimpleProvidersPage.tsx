"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import ConnectProviderDialog, { type ConnectTarget } from "./components/ConnectProviderDialog";
import ConnectedProviders, {
  type ConnectionRow,
  type ProviderGroup,
} from "./components/ConnectedProviders";
import ProviderGallery from "./components/ProviderGallery";

interface NodeInfo {
  id: string;
  name?: string;
  type?: string;
}

async function getJson(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

interface PageData {
  connections: ConnectionRow[];
  nodes: NodeInfo[];
  modelCounts: Record<string, number>;
}

async function loadPageData(): Promise<PageData> {
  const [providers, nodeData, map] = await Promise.all([
    getJson("/api/providers"),
    getJson("/api/provider-nodes"),
    getJson("/api/model-map"),
  ]);
  const modelCounts: Record<string, number> = {};
  for (const model of Array.isArray(map?.models) ? map.models : []) {
    modelCounts[model.provider] = (modelCounts[model.provider] || 0) + 1;
  }
  return {
    connections: Array.isArray(providers?.connections) ? providers.connections : [],
    nodes: Array.isArray(nodeData?.nodes) ? nodeData.nodes : [],
    modelCounts,
  };
}

/** Providers, the simple way: what you have connected, and a gallery to add more. */
export default function SimpleProvidersPage() {
  const t = useTranslations("providerGallery");
  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [modelCounts, setModelCounts] = useState<Record<string, number>>({});
  const [target, setTarget] = useState<ConnectTarget | null>(null);
  // A fresh dialog (and fresh form state) for every provider picked.
  const [targetKey, setTargetKey] = useState(0);
  const pick = (next: ConnectTarget) => {
    setTargetKey((k) => k + 1);
    setTarget(next);
  };
  const galleryRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((data: PageData) => {
    setConnections(data.connections);
    setNodes(data.nodes);
    setModelCounts(data.modelCounts);
  }, []);
  const load = useCallback(() => loadPageData().then(apply), [apply]);

  useEffect(() => {
    let cancelled = false;
    loadPageData().then((data) => {
      if (!cancelled) apply(data);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const groups = useMemo<ProviderGroup[]>(() => {
    if (!connections) return [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const byProvider = new Map<string, ConnectionRow[]>();
    for (const connection of connections) {
      const list = byProvider.get(connection.provider) || [];
      list.push(connection);
      byProvider.set(connection.provider, list);
    }
    return [...byProvider.entries()]
      .map(([providerId, list]) => {
        const node = nodeById.get(providerId);
        const iconId = node
          ? String(node.type || "").startsWith("anthropic")
            ? "anthropic-m"
            : "oai-cc"
          : providerId;
        return {
          providerId,
          displayName: node?.name || AI_PROVIDERS[providerId]?.name || list[0]?.name || providerId,
          iconId,
          connections: list,
          modelCount: modelCounts[providerId] ?? null,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [connections, nodes, modelCounts]);

  const connectedIds = useMemo(() => new Set(groups.map((g) => g.providerId)), [groups]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text-main">{t("yourProviders")}</h2>
            <p className="text-sm text-text-muted">{t("yourProvidersBody")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/providers?view=all"
              className="text-sm font-medium text-text-muted hover:text-text-main"
            >
              {t("detailedView")}
            </Link>
            {groups.length > 0 && (
              <Button
                icon="add"
                onClick={() => galleryRef.current?.scrollIntoView({ behavior: "smooth" })}
              >
                {t("addProvider")}
              </Button>
            )}
          </div>
        </div>

        {connections === null ? (
          <div className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
            <span
              className="material-symbols-outlined text-[36px] text-text-muted"
              aria-hidden="true"
            >
              dns
            </span>
            <h3 className="mt-2 font-semibold text-text-main">{t("emptyTitle")}</h3>
            <p className="mt-1 max-w-md text-sm text-text-muted">{t("emptyBody")}</p>
          </div>
        ) : (
          <ConnectedProviders groups={groups} onChanged={load} />
        )}
      </section>

      <section ref={galleryRef} className="flex scroll-mt-6 flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-main">{t("addTitle")}</h2>
          <p className="text-sm text-text-muted">{t("addBody")}</p>
        </div>
        <ProviderGallery connectedIds={connectedIds} onPick={pick} />
      </section>

      <ConnectProviderDialog
        key={targetKey}
        target={target}
        onClose={() => setTarget(null)}
        onConnected={load}
      />
    </div>
  );
}
