/**
 * Connect apps to Cool Router: Claude Code, Codex, Claude Desktop and "any app".
 *
 * Each app gets its own Cool Router API key (named after the app, reused on
 * reconnect). For Claude Code and Codex, Cool Router edits the app's user config
 * file: a backup is taken first, and the original value of every key it changes is
 * recorded, so Disconnect restores exactly those keys and leaves other edits alone.
 * Claude Desktop keeps its gateway settings in an app-managed, encrypted folder, so
 * it gets an importable setup file instead.
 */

import fs from "fs/promises";
import path from "path";
import { createApiKey, getApiKeyById } from "@/lib/db/apiKeys";
import {
  deleteClientConnection,
  getClientConnection,
  saveClientConnection,
  type ClientConnection,
  type ClientToolId,
} from "@/lib/db/clientConnections";
import {
  deleteCliToolInitialConfig,
  getCliToolInitialConfig,
  saveCliToolInitialConfig,
  saveCliToolLastConfigured,
} from "@/lib/db/cliToolState";
import { enableModelMapRules, getModelMap } from "@/lib/db/modelMap";
import { listMapModels, type MapModel } from "@/lib/modelMap/candidates";
import { MODEL_MAP_TIERS, type ModelMapTier } from "@/lib/modelMap/tiers";
import { getLatestCallForApiKey } from "@/lib/usage/callLogs";
import { createBackup } from "@/shared/services/backupService";
import { ensureCliConfigWriteAllowed, getCliConfigHome } from "@/shared/services/cliRuntime";
import {
  applyClaudeEnvChanges,
  buildClaudeCodeEnv,
  readClaudeCodeConnection,
  restoreClaudeSettings,
  snapshotClaudeSettings,
  type ClaudeCodeSnapshot,
} from "@/shared/services/clientConfig/claudeCode";
import {
  applyCodexConfig,
  CodexConfigError,
  readCodexConnection,
  restoreCodexConfig,
  snapshotCodexConfig,
  type CodexSnapshot,
} from "@/shared/services/clientConfig/codex";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const TOOL_KEY_NAMES: Record<ClientToolId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "claude-desktop": "Claude Desktop",
  other: "My apps",
};

/** Raised for problems the user can fix; the message is shown as is. */
export class ConnectError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ConnectError";
    this.status = status;
  }
}

// ──────────────── Where things are ────────────────

/** Cool Router's own address as apps on this computer reach it. */
export function getLocalServerAddress(request: Request): { baseUrl: string; port: number } {
  let port = Number(process.env.PORT || 0);
  try {
    const fromUrl = Number(new URL(request.url).port);
    if (fromUrl > 0) port = fromUrl;
  } catch {
    // keep env port
  }
  if (!port) port = 20128;
  // The desktop app binds IPv4 loopback; "localhost" can resolve to ::1 first.
  return { baseUrl: `http://127.0.0.1:${port}`, port };
}

function absoluteEnvDir(name: string): string | null {
  const value = String(process.env[name] || "").trim();
  return value && path.isAbsolute(value) ? path.normalize(value) : null;
}

export function getClaudeSettingsPath(): string {
  const dir = absoluteEnvDir("CLAUDE_CONFIG_DIR") || path.join(getCliConfigHome(), ".claude");
  return path.join(dir, "settings.json");
}

export function getCodexConfigPath(): string {
  const dir = absoluteEnvDir("CODEX_HOME") || path.join(getCliConfigHome(), ".codex");
  return path.join(dir, "config.toml");
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeTextFile(filePath: string, text: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.coolrouter-${process.pid}.tmp`;
  await fs.writeFile(temp, text, "utf8");
  await fs.rename(temp, filePath);
}

// ──────────────── Keys ────────────────

/** The app's own API key: reused while it exists and is active, otherwise a new one. */
export async function ensureToolApiKey(
  tool: ClientToolId
): Promise<{ id: string; key: string; created: boolean }> {
  const existing = getClientConnection(tool);
  if (existing?.apiKeyId) {
    const record = (await getApiKeyById(existing.apiKeyId)) as Record<string, unknown> | null;
    if (record && record.isActive !== false && typeof record.key === "string") {
      return { id: existing.apiKeyId, key: record.key, created: false };
    }
  }
  const machineId = await getConsistentMachineId();
  const created = await createApiKey(TOOL_KEY_NAMES[tool], machineId);
  return { id: created.id, key: created.key, created: true };
}

async function isKeyActive(apiKeyId: string | null): Promise<boolean> {
  if (!apiKeyId) return false;
  const record = (await getApiKeyById(apiKeyId)) as Record<string, unknown> | null;
  return Boolean(record) && record.isActive !== false;
}

// ──────────────── What the routes look like to an app ────────────────

export interface RouteSummary {
  labels: Partial<Record<ModelMapTier, string | null>>;
  /** Smallest known context window among the models that answer first */
  smallestFirstContext: number | null;
  contextByTier: Partial<Record<ModelMapTier, number | null>>;
  hasNonAnthropicModels: boolean;
  isEmpty: boolean;
}

const ANTHROPIC_ALIASES = new Set(["anthropic", "claude", "cc"]);

export async function summarizeRoutes(request: Request): Promise<RouteSummary> {
  const map = await getModelMap();
  const models = await listMapModels(request).catch(() => [] as MapModel[]);
  const byId = new Map(models.map((m) => [m.id, m]));

  const labels: RouteSummary["labels"] = {};
  const contextByTier: RouteSummary["contextByTier"] = {};
  const firstContexts: number[] = [];
  let hasNonAnthropicModels = false;
  let isEmpty = true;

  for (const tier of MODEL_MAP_TIERS) {
    const route = map.routes[tier];
    const serving = route.servedBy ? map.routes[route.servedBy] : null;
    const routeModels = serving?.models ?? [];
    if (route.models.length > 0) isEmpty = false;
    for (const id of route.models) {
      if (!ANTHROPIC_ALIASES.has(id.split("/")[0])) hasNonAnthropicModels = true;
    }
    const first = routeModels[0] ? byId.get(routeModels[0]) : undefined;
    labels[tier] = first?.name ?? (routeModels[0] ? routeModels[0].split("/").pop() : null);
    contextByTier[tier] = first?.contextLength ?? null;
    if (typeof first?.contextLength === "number") firstContexts.push(first.contextLength);
  }

  return {
    labels,
    contextByTier,
    smallestFirstContext: firstContexts.length > 0 ? Math.min(...firstContexts) : null,
    hasNonAnthropicModels,
    isEmpty,
  };
}

// ──────────────── Status shared by every app ────────────────

export interface ConnectionStatus {
  connected: boolean;
  /** Connected, but the app's config was changed or the port moved since */
  needsUpdate: boolean;
  /** Connected, but its key was deleted or turned off in API keys */
  keyRevoked: boolean;
  port: number | null;
  configPath: string | null;
  lastSeen: ReturnType<typeof getLatestCallForApiKey>;
  connectedAt: string | null;
}

async function baseStatus(
  connection: ClientConnection | null,
  currentPort: number,
  configPath: string | null
): Promise<ConnectionStatus> {
  if (!connection) {
    return {
      connected: false,
      needsUpdate: false,
      keyRevoked: false,
      port: null,
      configPath,
      lastSeen: null,
      connectedAt: null,
    };
  }
  const keyRevoked = !(await isKeyActive(connection.apiKeyId));
  return {
    connected: true,
    needsUpdate: Boolean(connection.port && connection.port !== currentPort),
    keyRevoked,
    port: connection.port,
    configPath,
    lastSeen: connection.apiKeyId ? getLatestCallForApiKey(connection.apiKeyId) : null,
    connectedAt: connection.connectedAt,
  };
}

// ──────────────── Claude Code ────────────────

const CLAUDE_SNAPSHOT_ID = "connect:claude-code";

export async function getClaudeCodeStatus(request: Request) {
  const { port } = getLocalServerAddress(request);
  const settingsPath = getClaudeSettingsPath();
  const connection = getClientConnection("claude-code");
  const status = await baseStatus(connection, port, settingsPath);
  if (connection?.configWritten) {
    const text = await readTextFile(settingsPath).catch(() => null);
    const apiKey = connection.apiKeyId
      ? (((await getApiKeyById(connection.apiKeyId)) as Record<string, unknown> | null)?.key as
          string | undefined)
      : undefined;
    const current = readClaudeCodeConnection(text, apiKey ?? null);
    if (!current.pointsHere || current.baseUrl !== `http://127.0.0.1:${port}`) {
      status.needsUpdate = true;
    }
  }
  return status;
}

export async function connectClaudeCode(request: Request) {
  const writeBlocked = ensureCliConfigWriteAllowed();
  if (writeBlocked) throw new ConnectError(writeBlocked, 403);

  const { baseUrl, port } = getLocalServerAddress(request);
  const settingsPath = getClaudeSettingsPath();
  const text = await readTextFile(settingsPath);

  let snapshot: ClaudeCodeSnapshot;
  try {
    snapshot = snapshotClaudeSettings(text);
  } catch {
    throw new ConnectError(
      `Claude Code's settings file isn't valid JSON, so Cool Router left it alone: ${settingsPath}. Fix the file, or follow the manual steps below.`
    );
  }

  const key = await ensureToolApiKey("claude-code");
  const summary = await summarizeRoutes(request);
  const changes = buildClaudeCodeEnv({
    baseUrl,
    apiKey: key.key,
    routeLabels: summary.labels,
    compactWindow: summary.smallestFirstContext,
    hasNonAnthropicModels: summary.hasNonAnthropicModels,
  });

  // First connect only: remember what was there before Cool Router.
  saveCliToolInitialConfig(CLAUDE_SNAPSHOT_ID, snapshot as unknown as Record<string, unknown>);
  await createBackup("claude-code", settingsPath);
  await writeTextFile(settingsPath, applyClaudeEnvChanges(text, changes));

  saveClientConnection({
    tool: "claude-code",
    apiKeyId: key.id,
    port,
    baseUrl,
    route: null,
    configWritten: true,
  });
  saveCliToolLastConfigured("claude-code");
  await enableModelMapRules();

  return { settingsPath, baseUrl, env: changes, keyCreated: key.created };
}

export async function disconnectClaudeCode() {
  const writeBlocked = ensureCliConfigWriteAllowed();
  if (writeBlocked) throw new ConnectError(writeBlocked, 403);

  const settingsPath = getClaudeSettingsPath();
  const connection = getClientConnection("claude-code");
  const snapshot = getCliToolInitialConfig(CLAUDE_SNAPSHOT_ID) as unknown as ClaudeCodeSnapshot;
  if (connection?.configWritten && snapshot?.env) {
    const text = await readTextFile(settingsPath);
    if (text !== null) {
      try {
        const restored = restoreClaudeSettings(text, snapshot);
        await createBackup("claude-code", settingsPath);
        await writeTextFile(settingsPath, restored);
      } catch {
        throw new ConnectError(
          `Claude Code's settings file isn't valid JSON, so Cool Router left it alone: ${settingsPath}`
        );
      }
    }
  }
  deleteCliToolInitialConfig(CLAUDE_SNAPSHOT_ID);
  deleteClientConnection("claude-code");
  return { settingsPath };
}

/** Mark a tool connected without writing files (manual setup, setup file). */
export async function registerManualConnection(
  tool: ClientToolId,
  request: Request,
  route: string | null = null
) {
  const { baseUrl, port } = getLocalServerAddress(request);
  const key = await ensureToolApiKey(tool);
  saveClientConnection({ tool, apiKeyId: key.id, port, baseUrl, route, configWritten: false });
  saveCliToolLastConfigured(tool);
  await enableModelMapRules();
  return { key, baseUrl, port };
}

// ──────────────── Codex ────────────────

const CODEX_SNAPSHOT_ID = "connect:codex";

export async function getCodexStatus(request: Request) {
  const { port } = getLocalServerAddress(request);
  const configPath = getCodexConfigPath();
  const connection = getClientConnection("codex");
  const status = await baseStatus(connection, port, configPath);
  if (connection?.configWritten) {
    const text = await readTextFile(configPath).catch(() => null);
    const apiKey = connection.apiKeyId
      ? (((await getApiKeyById(connection.apiKeyId)) as Record<string, unknown> | null)?.key as
          string | undefined)
      : undefined;
    const current = readCodexConnection(text, apiKey ?? null);
    if (!current.pointsHere || current.baseUrl !== `http://127.0.0.1:${port}/v1`) {
      status.needsUpdate = true;
    }
  }
  return { ...status, route: connection?.route ?? "sonnet" };
}

export async function connectCodex(request: Request, route: ModelMapTier) {
  const writeBlocked = ensureCliConfigWriteAllowed();
  if (writeBlocked) throw new ConnectError(writeBlocked, 403);

  const { baseUrl, port } = getLocalServerAddress(request);
  const configPath = getCodexConfigPath();
  const text = await readTextFile(configPath);

  let snapshot: CodexSnapshot;
  try {
    snapshot = snapshotCodexConfig(text);
  } catch (error) {
    const reason = error instanceof CodexConfigError ? error.message : "It couldn't be read.";
    throw new ConnectError(
      `${reason} Cool Router left it alone: ${configPath}. Follow the manual steps below instead.`
    );
  }

  const key = await ensureToolApiKey("codex");
  const summary = await summarizeRoutes(request);
  const settings = {
    baseUrl: `${baseUrl}/v1`,
    apiKey: key.key,
    model: route,
    contextWindow: summary.contextByTier[route] ?? null,
  };

  let next: string;
  try {
    next = applyCodexConfig(text, settings);
  } catch (error) {
    throw new ConnectError(
      `${error instanceof Error ? error.message : "Edit failed."} Nothing was changed.`
    );
  }

  saveCliToolInitialConfig(CODEX_SNAPSHOT_ID, snapshot as unknown as Record<string, unknown>);
  await createBackup("codex", configPath);
  await writeTextFile(configPath, next);

  saveClientConnection({
    tool: "codex",
    apiKeyId: key.id,
    port,
    baseUrl,
    route,
    configWritten: true,
  });
  saveCliToolLastConfigured("codex");
  await enableModelMapRules();
  return { configPath, settings: { ...settings, apiKey: undefined }, keyCreated: key.created };
}

export async function disconnectCodex() {
  const writeBlocked = ensureCliConfigWriteAllowed();
  if (writeBlocked) throw new ConnectError(writeBlocked, 403);

  const configPath = getCodexConfigPath();
  const connection = getClientConnection("codex");
  const snapshot = getCliToolInitialConfig(CODEX_SNAPSHOT_ID) as unknown as CodexSnapshot;
  if (connection?.configWritten && snapshot?.topLevel) {
    const text = await readTextFile(configPath);
    if (text !== null) {
      try {
        const restored = restoreCodexConfig(text, snapshot);
        await createBackup("codex", configPath);
        await writeTextFile(configPath, restored);
      } catch {
        throw new ConnectError(
          `Your Codex config.toml isn't valid TOML any more, so Cool Router left it alone: ${configPath}`
        );
      }
    }
  }
  deleteCliToolInitialConfig(CODEX_SNAPSHOT_ID);
  deleteClientConnection("codex");
  return { configPath };
}
