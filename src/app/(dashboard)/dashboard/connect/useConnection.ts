"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientState } from "./components/ClientCard";

export interface LastSeen {
  timestamp: string;
  model: string | null;
  requestedModel: string | null;
  provider: string | null;
  status: number | null;
}

export interface ConnectionInfo {
  connected: boolean;
  needsUpdate?: boolean;
  keyRevoked?: boolean;
  installed?: boolean;
  baseUrl?: string;
  connectedAt?: string | null;
  lastSeen?: LastSeen | null;
  route?: string;
  settingsPath?: string;
  configPath?: string;
}

const POLL_MS = 4000;
const RESTART_HINT_MS = 60_000;

export async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function postJson(url: string, body: unknown = {}, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Something went wrong"));
  return response.json();
}

/**
 * Status of one app plus the "waiting for your first message" check: after
 * connecting, polls until a request made with the app's key arrives.
 */
export function useConnection(statusUrl: string, tool: string) {
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [showRestartHint, setShowRestartHint] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(statusUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "Could not check"));
      setInfo(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [statusUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const seenSinceConnect = Boolean(
    info?.lastSeen?.timestamp &&
    info?.connectedAt &&
    new Date(info.lastSeen.timestamp).getTime() >= new Date(info.connectedAt).getTime() - 1000
  );

  // Poll last-seen while waiting for the first message.
  useEffect(() => {
    const waiting = info?.connected && !seenSinceConnect;
    if (!waiting) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      return;
    }
    if (waitingSince === null) setWaitingSince(Date.now());
    pollTimer.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/cli-tools/last-seen?tool=${tool}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        setInfo((current) => (current ? { ...current, lastSeen: data.lastSeen } : current));
      } catch {
        // Try again on the next tick.
      }
    }, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [info?.connected, seenSinceConnect, tool, waitingSince]);

  useEffect(() => {
    if (waitingSince === null || seenSinceConnect) {
      setShowRestartHint(false);
      return;
    }
    const timer = setTimeout(() => setShowRestartHint(true), RESTART_HINT_MS);
    return () => clearTimeout(timer);
  }, [waitingSince, seenSinceConnect]);

  let state: ClientState = "loading";
  if (info) {
    if (!info.connected) state = "not-connected";
    else if (info.needsUpdate || info.keyRevoked) state = "needs-update";
    else if (seenSinceConnect || info.lastSeen) state = seenSinceConnect ? "live" : "waiting";
    else state = "waiting";
  }

  return {
    info,
    error,
    state,
    refresh,
    showRestartHint,
    markConnected: () => {
      setWaitingSince(Date.now());
      return refresh();
    },
  };
}
