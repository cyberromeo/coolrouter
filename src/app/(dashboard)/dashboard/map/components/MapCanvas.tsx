"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/shared/utils/cn";
import type { ModelMapTier } from "@/lib/modelMap/tiers";
import ModelChip from "./ModelChip";
import ModelPicker from "./ModelPicker";
import ModelPalette, { PALETTE_DRAG_TYPE } from "./ModelPalette";
import { TIER_META, TIERS } from "../tierMeta";
import { moveItem, type MapModelInfo, type ModelMapState } from "../useModelMap";

// ── Layout (left → right: apps, Cool Router, routes, models) ───────────────
const COL_CLIENT = 0;
const COL_HUB = 225;
const COL_ROUTE = 405;
const COL_MODEL = 645;
const MODEL_GAP = 222;
const ROW_GAP = 130;
const ROUTE_HEIGHT = 72;
const CLIENT_GAP = 78;

const rowY = (row: number) => row * ROW_GAP;
const CENTER_Y = rowY(1) + ROUTE_HEIGHT / 2;

interface CanvasProps {
  map: ModelMapState;
  models: MapModelInfo[];
  modelsById: Map<string, MapModelInfo>;
  setRoute: (tier: ModelMapTier, models: string[]) => void;
}

type ClientStatus = Record<string, boolean>;

const CLIENTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    icon: "claude",
    url: "/api/cli-tools/claude-settings",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    icon: "anthropic",
    url: "/api/cli-tools/claude-desktop",
  },
  { id: "codex", label: "Codex", icon: "codex", url: "/api/cli-tools/codex-settings" },
  { id: "other", label: "Any app", icon: "", url: null },
];

// ── Node components ─────────────────────────────────────────────────────

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

type ClientData = { label: string; icon: string; connected: boolean; connectLabel: string };
const ClientNode = memo(function ClientNode({ data }: NodeProps<Node<ClientData>>) {
  return (
    <div
      className={cn(
        "flex w-[185px] items-center gap-2 rounded-xl border bg-surface px-2.5 py-2 shadow-soft",
        data.connected ? "border-border" : "border-dashed border-border opacity-60"
      )}
    >
      {data.icon ? (
        <ProviderIcon providerId={data.icon} size={18} type="color" />
      ) : (
        <span className="material-symbols-outlined text-[18px] text-text-muted" aria-hidden="true">
          apps
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-main">
        {data.label}
      </span>
      {data.connected ? (
        <span className="size-2 rounded-full bg-success" aria-hidden="true" />
      ) : (
        <a
          href="/dashboard/connect"
          title={data.connectLabel}
          aria-label={`${data.connectLabel} ${data.label}`}
          className="nodrag flex size-5 items-center justify-center rounded-md text-accent hover:bg-accent/10"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            add_link
          </span>
        </a>
      )}
      <Handle type="source" position={Position.Right} className={hiddenHandle} />
    </div>
  );
});

type HubData = { title: string; subtitle: string };
const HubNode = memo(function HubNode({ data }: NodeProps<Node<HubData>>) {
  return (
    <div className="flex w-[140px] flex-col items-center rounded-2xl border border-border bg-text-main px-3 py-3 text-center text-bg shadow-elevated">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <span className="text-sm font-semibold">{data.title}</span>
      <span className="text-[11px] opacity-70">{data.subtitle}</span>
      <Handle type="source" position={Position.Right} className={hiddenHandle} />
    </div>
  );
});

type RouteData = {
  tier: ModelMapTier;
  name: string;
  blurb: string;
  addLabel: string;
  onAdd: (tier: ModelMapTier) => void;
};
const RouteNode = memo(function RouteNode({ data }: NodeProps<Node<RouteData>>) {
  const meta = TIER_META[data.tier];
  return (
    <div
      className="flex w-[205px] items-center gap-2.5 rounded-xl border-2 bg-surface px-2.5 py-2.5 shadow-soft"
      style={{ borderColor: meta.colorVar, minHeight: ROUTE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ backgroundColor: meta.colorVar }}
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-[20px]">{meta.icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-main">{data.name}</div>
        <div className="line-clamp-2 text-[11px] leading-tight text-text-muted">{data.blurb}</div>
      </div>
      <button
        type="button"
        onClick={() => data.onAdd(data.tier)}
        className="nodrag flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-black/5 hover:text-text-main dark:hover:bg-white/10"
        title={data.addLabel}
        aria-label={data.addLabel}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          add
        </span>
      </button>
      <Handle type="source" position={Position.Right} className={hiddenHandle} />
    </div>
  );
});

type ModelData = {
  tier: ModelMapTier;
  index: number;
  modelId: string;
  info?: MapModelInfo;
  isLast: boolean;
  labels: { earlier: string; later: string; remove: string };
  onMove: (tier: ModelMapTier, from: number, to: number) => void;
  onRemove: (tier: ModelMapTier, index: number) => void;
};
const ModelNode = memo(function ModelNode({ data, dragging }: NodeProps<Node<ModelData>>) {
  const meta = TIER_META[data.tier];
  return (
    <div
      className={cn(
        "group w-[205px] cursor-grab rounded-xl border bg-surface px-2.5 py-2 shadow-soft transition-shadow active:cursor-grabbing",
        dragging ? "shadow-elevated ring-2" : "border-border"
      )}
      style={dragging ? { borderColor: meta.colorVar } : undefined}
    >
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <ModelChip modelId={data.modelId} info={data.info} position={data.index + 1} />
      <div className="nodrag mt-1.5 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {[
          {
            icon: "arrow_back",
            label: data.labels.earlier,
            disabled: data.index === 0,
            run: () => data.onMove(data.tier, data.index, data.index - 1),
          },
          {
            icon: "arrow_forward",
            label: data.labels.later,
            disabled: data.isLast,
            run: () => data.onMove(data.tier, data.index, data.index + 1),
          },
          {
            icon: "close",
            label: data.labels.remove,
            disabled: false,
            run: () => data.onRemove(data.tier, data.index),
          },
        ].map((action) => (
          <button
            key={action.icon}
            type="button"
            onClick={action.run}
            disabled={action.disabled}
            title={action.label}
            aria-label={action.label}
            className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-black/5 hover:text-text-main disabled:opacity-30 dark:hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              {action.icon}
            </span>
          </button>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className={hiddenHandle} />
    </div>
  );
});

type DropData = { tier: ModelMapTier; label: string; onAdd: (tier: ModelMapTier) => void };
const DropNode = memo(function DropNode({ data }: NodeProps<Node<DropData>>) {
  return (
    <button
      type="button"
      onClick={() => data.onAdd(data.tier)}
      className="nodrag flex h-[56px] w-[150px] items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-transparent px-2 text-center text-xs font-medium text-text-muted transition-colors hover:border-text-muted hover:text-text-main"
    >
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
        add
      </span>
      {data.label}
    </button>
  );
});

const nodeTypes = {
  client: ClientNode,
  hub: HubNode,
  route: RouteNode,
  model: ModelNode,
  drop: DropNode,
};

// ── Canvas ──────────────────────────────────────────────────────────────

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function useClientStatus(): ClientStatus {
  const [status, setStatus] = useState<ClientStatus>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      CLIENTS.filter((c) => c.url).map(async (client) => {
        try {
          const response = await fetch(client.url as string, { cache: "no-store" });
          const data = response.ok ? await response.json() : null;
          return [client.id, Boolean(data?.connected)] as const;
        } catch {
          return [client.id, false] as const;
        }
      })
    ).then((entries) => !cancelled && setStatus(Object.fromEntries(entries)));
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

function Canvas({ map, models, modelsById, setRoute }: CanvasProps) {
  const t = useTranslations("modelMap");
  const dark = useDarkMode();
  const clientStatus = useClientStatus();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [pickerTier, setPickerTier] = useState<ModelMapTier | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const routes = map.routes;

  const moveModel = useCallback(
    (tier: ModelMapTier, from: number, to: number) => {
      setRoute(tier, moveItem(routes[tier].models, from, to));
    },
    [routes, setRoute]
  );
  const removeModel = useCallback(
    (tier: ModelMapTier, index: number) => {
      setRoute(
        tier,
        routes[tier].models.filter((_, i) => i !== index)
      );
    },
    [routes, setRoute]
  );
  /** Place a model on a route at a position, moving it if it is already there. */
  const placeModel = useCallback(
    (modelId: string, tier: ModelMapTier, index: number, fromTier?: ModelMapTier) => {
      if (fromTier && fromTier !== tier) {
        setRoute(
          fromTier,
          routes[fromTier].models.filter((id) => id !== modelId)
        );
      }
      const without = routes[tier].models.filter((id) => id !== modelId);
      const at = Math.max(0, Math.min(index, without.length));
      setRoute(tier, [...without.slice(0, at), modelId, ...without.slice(at)]);
    },
    [routes, setRoute]
  );

  const layout = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const clientTop = CENTER_Y - ((CLIENTS.length - 1) * CLIENT_GAP) / 2 - 22;

    CLIENTS.forEach((client, i) => {
      const connected = client.id === "other" ? true : Boolean(clientStatus[client.id]);
      nodes.push({
        id: `client:${client.id}`,
        type: "client",
        position: { x: COL_CLIENT, y: clientTop + i * CLIENT_GAP },
        data: {
          label: client.label,
          icon: client.icon,
          connected,
          connectLabel: t("canvasConnect"),
        },
        draggable: false,
        selectable: false,
      });
      edges.push({
        id: `e:client:${client.id}`,
        source: `client:${client.id}`,
        target: "hub",
        animated: connected && client.id !== "other",
        style: {
          stroke: "var(--color-border)",
          strokeWidth: 1.5,
          strokeDasharray: connected ? undefined : "4 4",
        },
      });
    });

    nodes.push({
      id: "hub",
      type: "hub",
      position: { x: COL_HUB, y: CENTER_Y - 30 },
      data: { title: "Cool Router", subtitle: t("canvasHubSubtitle") },
      draggable: false,
      selectable: false,
    });

    TIERS.forEach((tier, row) => {
      const route = map.routes[tier];
      const color = TIER_META[tier].colorVar;
      nodes.push({
        id: `route:${tier}`,
        type: "route",
        position: { x: COL_ROUTE, y: rowY(row) },
        data: {
          tier,
          name: t(`tiers.${tier}.name`),
          blurb: t(`tiers.${tier}.blurb`),
          addLabel: t("addModelTo", { tier: t(`tiers.${tier}.name`) }),
          onAdd: setPickerTier,
        },
        draggable: false,
        selectable: false,
      });
      edges.push({
        id: `e:hub:${tier}`,
        source: "hub",
        target: `route:${tier}`,
        style: { stroke: color, strokeWidth: 2 },
      });

      route.models.forEach((modelId, index) => {
        nodes.push({
          id: `model:${tier}:${modelId}`,
          type: "model",
          position: { x: COL_MODEL + index * MODEL_GAP, y: rowY(row) + 4 },
          data: {
            tier,
            index,
            modelId,
            info: modelsById.get(modelId),
            isLast: index === route.models.length - 1,
            labels: { earlier: t("moveEarlier"), later: t("moveLater"), remove: t("removeModel") },
            onMove: moveModel,
            onRemove: removeModel,
          },
          dragHandle: undefined,
        });
        edges.push({
          id: `e:${tier}:${index}`,
          source: index === 0 ? `route:${tier}` : `model:${tier}:${route.models[index - 1]}`,
          target: `model:${tier}:${modelId}`,
          style: {
            stroke: color,
            strokeWidth: index === 0 ? 2 : 1.5,
            strokeDasharray: index === 0 ? undefined : "5 5",
            opacity: index === 0 ? 1 : 0.7,
          },
        });
      });

      const dropId = `drop:${tier}`;
      nodes.push({
        id: dropId,
        type: "drop",
        position: { x: COL_MODEL + route.models.length * MODEL_GAP, y: rowY(row) + 8 },
        data: {
          tier,
          label:
            route.models.length === 0 && route.servedBy && route.servedBy !== tier
              ? t("canvasEmptyBorrowing", { tier: t(`tiers.${route.servedBy}.name`) })
              : t("addModel"),
          onAdd: setPickerTier,
        },
        draggable: false,
        selectable: false,
      });
      if (route.models.length === 0) {
        edges.push({
          id: `e:${tier}:drop`,
          source: `route:${tier}`,
          target: dropId,
          style: { stroke: color, strokeWidth: 1.5, strokeDasharray: "4 4", opacity: 0.5 },
        });
      }
    });
    return { nodes, edges };
  }, [map.routes, modelsById, clientStatus, t, moveModel, removeModel]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layout.nodes);
  useEffect(() => setNodes(layout.nodes), [layout.nodes, setNodes]);

  const longestRoute = Math.max(...TIERS.map((tier) => map.routes[tier].models.length));
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.06, maxZoom: 1, duration: 250 }), 50);
    return () => clearTimeout(timer);
  }, [longestRoute, fitView]);

  /** Row and slot under a flow position. */
  const slotAt = (x: number, y: number) => {
    const row = Math.max(0, Math.min(TIERS.length - 1, Math.round((y - 4) / ROW_GAP)));
    const index = Math.max(0, Math.round((x - COL_MODEL) / MODEL_GAP));
    return { tier: TIERS[row], index };
  };

  const onNodeDragStop = (_: unknown, node: Node) => {
    if (node.type !== "model") return;
    const data = node.data as ModelData;
    const { tier, index } = slotAt(node.position.x, node.position.y);
    if (tier === data.tier && index === data.index) {
      setNodes(layout.nodes);
      return;
    }
    placeModel(data.modelId, tier, index, data.tier);
  };

  const onDrop = (event: React.DragEvent) => {
    const modelId = event.dataTransfer.getData(PALETTE_DRAG_TYPE);
    if (!modelId) return;
    event.preventDefault();
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const { tier, index } = slotAt(position.x - 100, position.y - 30);
    placeModel(modelId, tier, index);
  };

  return (
    <div className="relative">
      <div
        ref={wrapper}
        className="coolrouter-map relative h-[560px] min-w-0 overflow-hidden rounded-xl border border-border bg-bg"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={onDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={layout.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          colorMode={dark ? "dark" : "light"}
          fitView
          fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
          minZoom={0.35}
          maxZoom={1.4}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="var(--color-border)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-text-muted shadow-soft">
          {t("canvasHint")}
        </p>
        {!paletteOpen && (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-main shadow-soft transition-colors hover:bg-bg"
            aria-expanded={paletteOpen}
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              view_sidebar
            </span>
            {t("paletteTitle")}
          </button>
        )}
        <ModelPalette
          models={models}
          map={map}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onAdd={(modelId, tier) => placeModel(modelId, tier, map.routes[tier].models.length)}
        />
      </div>

      <ModelPicker
        isOpen={pickerTier !== null}
        onClose={() => setPickerTier(null)}
        models={models}
        taken={pickerTier ? map.routes[pickerTier].models : []}
        title={pickerTier ? t("addModelTo", { tier: t(`tiers.${pickerTier}.name`) }) : ""}
        onPick={(modelId) => {
          if (pickerTier) placeModel(modelId, pickerTier, map.routes[pickerTier].models.length);
        }}
      />
    </div>
  );
}

/** The mind-map: apps → Cool Router → Opus / Sonnet / Haiku → models in fallback order. */
export default function MapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
