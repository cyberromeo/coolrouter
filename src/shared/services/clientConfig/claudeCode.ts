/**
 * Claude Code configuration — pure functions (no file access).
 *
 * Connecting Claude Code means merging a few variables into the `env` block of its
 * user settings file (~/.claude/settings.json). Everything else in the file is left
 * as it was. Before the first change, the original value of every variable we touch
 * is recorded, so disconnecting puts back exactly those keys and nothing else.
 */

import type { ModelMapTier } from "@/lib/modelMap/tiers";
import { TIER_CLAUDE_MODEL_IDS } from "@/lib/modelMap/tiers";

type JsonRecord = Record<string, unknown>;

/** Every env key Cool Router may set or remove in Claude Code's settings. */
export const CLAUDE_CODE_MANAGED_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  // A leftover API key next to the token makes Claude Code warn about two credentials.
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
  "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
] as const;

export type ClaudeCodeEnvKey = (typeof CLAUDE_CODE_MANAGED_ENV_KEYS)[number];

/** Desired value per key; null removes the key. */
export type ClaudeCodeEnvChanges = Partial<Record<ClaudeCodeEnvKey, string | null>>;

/** Original values before Cool Router touched them; null means "was not set". */
export type ClaudeCodeSnapshot = {
  env: Partial<Record<ClaudeCodeEnvKey, string | null>>;
  envBlockExisted: boolean;
};

export interface ClaudeCodeEnvInput {
  /** Cool Router's address without /v1, e.g. http://127.0.0.1:20128 */
  baseUrl: string;
  apiKey: string;
  /** Label of the model answering first on each route, for the /model picker */
  routeLabels: Partial<Record<ModelMapTier, string | null>>;
  /** Smallest context window among the first models, if known */
  compactWindow?: number | null;
  /** True when any route uses a model that is not served by Anthropic */
  hasNonAnthropicModels: boolean;
}

const TIER_ENV: Record<ModelMapTier, { model: ClaudeCodeEnvKey; name: ClaudeCodeEnvKey }> = {
  opus: { model: "ANTHROPIC_DEFAULT_OPUS_MODEL", name: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME" },
  sonnet: { model: "ANTHROPIC_DEFAULT_SONNET_MODEL", name: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME" },
  haiku: { model: "ANTHROPIC_DEFAULT_HAIKU_MODEL", name: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME" },
};

const TIER_TITLES: Record<ModelMapTier, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

/** Claude Code clamps the auto-compact window to 100k–1M tokens. */
export function clampCompactWindow(tokens: number | null | undefined): number | null {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return null;
  return Math.min(1_000_000, Math.max(100_000, Math.floor(tokens)));
}

/** The env values Claude Code needs to use Cool Router's routes. */
export function buildClaudeCodeEnv(input: ClaudeCodeEnvInput): ClaudeCodeEnvChanges {
  const changes: ClaudeCodeEnvChanges = {
    ANTHROPIC_BASE_URL: input.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, ""),
    ANTHROPIC_AUTH_TOKEN: input.apiKey,
    ANTHROPIC_API_KEY: null,
    // A pinned session model would bypass the tier variables.
    ANTHROPIC_MODEL: null,
  };

  for (const tier of Object.keys(TIER_ENV) as ModelMapTier[]) {
    const keys = TIER_ENV[tier];
    // Real Claude ids keep Claude Code's capability detection and context sizes.
    changes[keys.model] = TIER_CLAUDE_MODEL_IDS[tier];
    const label = input.routeLabels[tier];
    changes[keys.name] = label
      ? `${TIER_TITLES[tier]} → ${label} (Cool Router)`
      : `${TIER_TITLES[tier]} (Cool Router)`;
  }

  const window = clampCompactWindow(input.compactWindow);
  changes.CLAUDE_CODE_AUTO_COMPACT_WINDOW = window ? String(window) : null;
  // Pre-release request fields are only safe when every route ends at Anthropic.
  changes.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = input.hasNonAnthropicModels ? "1" : null;
  return changes;
}

export class ClaudeSettingsParseError extends Error {
  constructor() {
    super("Claude Code's settings.json is not valid JSON");
    this.name = "ClaudeSettingsParseError";
  }
}

function parseSettings(text: string | null | undefined): JsonRecord {
  const trimmed = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ClaudeSettingsParseError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ClaudeSettingsParseError();
  }
  return parsed as JsonRecord;
}

function envOf(settings: JsonRecord): JsonRecord {
  const env = settings.env;
  return env && typeof env === "object" && !Array.isArray(env) ? (env as JsonRecord) : {};
}

function serialize(settings: JsonRecord): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Record what the managed keys hold right now (before the first change). */
export function snapshotClaudeSettings(text: string | null | undefined): ClaudeCodeSnapshot {
  const settings = parseSettings(text);
  const env = envOf(settings);
  const snapshot: ClaudeCodeSnapshot = {
    env: {},
    envBlockExisted: settings.env !== undefined,
  };
  for (const key of CLAUDE_CODE_MANAGED_ENV_KEYS) {
    snapshot.env[key] = typeof env[key] === "string" ? (env[key] as string) : null;
  }
  return snapshot;
}

/** Apply env changes to the settings file text, keeping every other setting. */
export function applyClaudeEnvChanges(
  text: string | null | undefined,
  changes: ClaudeCodeEnvChanges
): string {
  const settings = parseSettings(text);
  const env = { ...envOf(settings) };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete env[key];
    else env[key] = value;
  }
  return serialize({ ...settings, env });
}

/** Put back exactly the values recorded before connecting. */
export function restoreClaudeSettings(
  text: string | null | undefined,
  snapshot: ClaudeCodeSnapshot
): string {
  const settings = parseSettings(text);
  const env = { ...envOf(settings) };
  for (const key of CLAUDE_CODE_MANAGED_ENV_KEYS) {
    const original = snapshot.env[key];
    if (typeof original === "string") env[key] = original;
    else delete env[key];
  }
  const next: JsonRecord = { ...settings, env };
  if (!snapshot.envBlockExisted && Object.keys(env).length === 0) delete next.env;
  return serialize(next);
}

/** Is this settings file pointed at Cool Router (any port)? */
export function readClaudeCodeConnection(
  text: string | null | undefined,
  apiKey: string | null
): { pointsHere: boolean; baseUrl: string | null; usesOurKey: boolean } {
  let settings: JsonRecord;
  try {
    settings = parseSettings(text);
  } catch {
    return { pointsHere: false, baseUrl: null, usesOurKey: false };
  }
  const env = envOf(settings);
  const baseUrl = typeof env.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : null;
  const usesOurKey = Boolean(apiKey) && env.ANTHROPIC_AUTH_TOKEN === apiKey;
  return { pointsHere: usesOurKey && Boolean(baseUrl), baseUrl, usesOurKey };
}
