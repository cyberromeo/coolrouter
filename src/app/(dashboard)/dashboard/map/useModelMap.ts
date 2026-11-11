"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelMapTier } from "@/lib/modelMap/tiers";

export interface MapModelInfo {
  id: string;
  provider: string;
  modelId: string;
  name: string;
  providerName: string;
  iconId?: string;
  contextLength?: number | null;
  price?: number | null;
  toolCalling?: boolean | null;
}

export interface MapRoute {
  tier: ModelMapTier;
  comboId: string | null;
  comboName: string;
  models: string[];
  servedBy: ModelMapTier | null;
}

export interface MapConflict {
  id: string;
  pattern: string;
  comboName: string | null;
  priority: number;
}

export interface ModelMapState {
  routes: Record<ModelMapTier, MapRoute>;
  rulesInstalled: boolean;
  conflicts: MapConflict[];
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVE_DELAY_MS = 500;

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return data?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Loads the model map and the models the user can place, and saves route edits
 * after a short pause (several quick drags become one save).
 */
export function useModelMap() {
  const [map, setMap] = useState<ModelMapState | null>(null);
  const [models, setModels] = useState<MapModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const timers = useRef<Partial<Record<ModelMapTier, ReturnType<typeof setTimeout>>>>({});
  const pending = useRef(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch("/api/model-map", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Could not load the map"));
      const data = await response.json();
      setMap(data.map);
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const pendingTimers = timers.current;
    return () => {
      for (const timer of Object.values(pendingTimers)) clearTimeout(timer);
    };
  }, [load]);

  const persistRoute = useCallback(async (tier: ModelMapTier, routeModels: string[]) => {
    pending.current += 1;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const response = await fetch("/api/model-map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, models: routeModels }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not save"));
      const data = await response.json();
      pending.current -= 1;
      // Keep local edits the user made while this save was in flight.
      if (pending.current === 0) setMap(data.map);
      if (pending.current === 0) setSaveStatus("saved");
    } catch (error) {
      pending.current -= 1;
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  /** Update a route locally right away and save it after a short pause. */
  const setRoute = useCallback(
    (tier: ModelMapTier, routeModels: string[]) => {
      setMap((current) =>
        current
          ? {
              ...current,
              routes: {
                ...current.routes,
                [tier]: { ...current.routes[tier], models: routeModels },
              },
            }
          : current
      );
      setSaveStatus("saving");
      clearTimeout(timers.current[tier]);
      timers.current[tier] = setTimeout(() => persistRoute(tier, routeModels), SAVE_DELAY_MS);
    },
    [persistRoute]
  );

  const autoFill = useCallback(async (force = false) => {
    setSaveStatus("saving");
    try {
      const response = await fetch("/api/model-map/auto-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not arrange models"));
      const data = await response.json();
      setMap(data.map);
      setSaveStatus(data.filled ? "saved" : "idle");
      return data.filled === true;
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);

  const modelsById = new Map(models.map((m) => [m.id, m]));

  return {
    map,
    models,
    modelsById,
    loading,
    loadError,
    saveStatus,
    saveError,
    reload: load,
    setRoute,
    autoFill,
  };
}

/** Move an item within a list (for reordering a route). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
