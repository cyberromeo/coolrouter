/**
 * db/clientConnections.ts — which apps (Claude Code, Codex, Claude Desktop, ...) the
 * user connected from the Connect page, with the key and port written for each.
 *
 * Stored in key_value (namespace "clientConnection"), one row per tool.
 */

import { getDbInstance, isBuildPhase, isCloud } from "./core";

export const CLIENT_TOOL_IDS = ["claude-code", "codex", "claude-desktop", "other"] as const;
export type ClientToolId = (typeof CLIENT_TOOL_IDS)[number];

export interface ClientConnection {
  tool: ClientToolId;
  /** The Cool Router API key created for this app */
  apiKeyId: string | null;
  /** The port written into the app's config (to spot a changed port later) */
  port: number | null;
  baseUrl: string | null;
  /** Route the app uses by name (Codex picks one) */
  route: string | null;
  /** True when Cool Router wrote the app's config file itself */
  configWritten: boolean;
  connectedAt: string;
}

const NAMESPACE = "clientConnection";

export function isClientToolId(value: unknown): value is ClientToolId {
  return typeof value === "string" && (CLIENT_TOOL_IDS as readonly string[]).includes(value);
}

export function getClientConnection(tool: ClientToolId): ClientConnection | null {
  if (isBuildPhase || isCloud) return null;
  const row = getDbInstance()
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(NAMESPACE, tool) as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? ({ ...parsed, tool } as ClientConnection) : null;
  } catch {
    return null;
  }
}

export function getAllClientConnections(): Partial<Record<ClientToolId, ClientConnection>> {
  const result: Partial<Record<ClientToolId, ClientConnection>> = {};
  for (const tool of CLIENT_TOOL_IDS) {
    const connection = getClientConnection(tool);
    if (connection) result[tool] = connection;
  }
  return result;
}

export function saveClientConnection(
  connection: Omit<ClientConnection, "connectedAt"> & { connectedAt?: string }
): ClientConnection {
  const record: ClientConnection = {
    ...connection,
    connectedAt: connection.connectedAt || new Date().toISOString(),
  };
  if (isBuildPhase || isCloud) return record;
  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(NAMESPACE, connection.tool, JSON.stringify(record));
  return record;
}

export function deleteClientConnection(tool: ClientToolId): void {
  if (isBuildPhase || isCloud) return;
  getDbInstance()
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run(NAMESPACE, tool);
}
