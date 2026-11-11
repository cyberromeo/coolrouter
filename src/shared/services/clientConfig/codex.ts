/**
 * Codex configuration — pure functions (no file access).
 *
 * Codex reads ~/.codex/config.toml. Connecting sets three top-level keys
 * (`model`, `model_provider`, `model_context_window`) and adds one table,
 * `[model_providers.coolrouter]`. The file is edited line by line so comments and
 * formatting elsewhere survive, then parsed again to prove the result is valid
 * TOML that says what we meant; if not, nothing is written.
 */

import { parse as parseToml } from "smol-toml";

export const CODEX_PROVIDER_ID = "coolrouter";
const MANAGED_TOP_LEVEL_KEYS = ["model", "model_provider", "model_context_window"] as const;
type TopLevelKey = (typeof MANAGED_TOP_LEVEL_KEYS)[number];

export interface CodexSettings {
  /** Cool Router's OpenAI-compatible base, with /v1 */
  baseUrl: string;
  apiKey: string;
  /** The route Codex asks for by name: "sonnet", "opus" or "haiku" */
  model: string;
  contextWindow?: number | null;
}

/** What was there before Cool Router: raw lines, so restoring is exact. */
export interface CodexSnapshot {
  topLevel: Partial<Record<TopLevelKey, string | null>>;
  /** The original [model_providers.coolrouter] block (and sub-tables), if any */
  providerBlock: string | null;
}

export class CodexConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexConfigError";
  }
}

interface ParsedLines {
  lines: string[];
  eol: string;
}

function splitLines(text: string | null | undefined): ParsedLines {
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { lines, eol };
}

function joinLines({ lines, eol }: ParsedLines): string {
  return lines.length > 0 ? `${lines.join(eol)}${eol}` : "";
}

const TABLE_HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

function tableName(line: string): string | null {
  const match = line.match(TABLE_HEADER);
  return match ? match[1].replace(/\s*\.\s*/g, ".").replace(/"/g, "") : null;
}

function firstTableIndex(lines: string[]): number {
  const index = lines.findIndex((line) => TABLE_HEADER.test(line));
  return index === -1 ? lines.length : index;
}

function topLevelKeyIndex(lines: string[], key: string): number {
  const end = firstTableIndex(lines);
  const pattern = new RegExp(`^\\s*"?${key}"?\\s*=`);
  for (let i = 0; i < end; i++) if (pattern.test(lines[i])) return i;
  return -1;
}

function isOurTable(name: string | null): boolean {
  return (
    name === `model_providers.${CODEX_PROVIDER_ID}` ||
    Boolean(name?.startsWith(`model_providers.${CODEX_PROVIDER_ID}.`))
  );
}

/** Line ranges [start, end) of our table and its sub-tables. */
function ourTableRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isOurTable(tableName(lines[i]))) continue;
    let end = i + 1;
    while (end < lines.length && !TABLE_HEADER.test(lines[end])) end++;
    ranges.push([i, end]);
    i = end - 1;
  }
  return ranges;
}

/** Shapes we don't edit line by line: provider settings as dotted keys or inline tables. */
function assertEditable(lines: string[]) {
  for (const line of lines) {
    if (/^\s*model_providers\s*\./.test(line) || /^\s*model_providers\s*=/.test(line)) {
      throw new CodexConfigError(
        "Your Codex config defines model_providers in a compact form Cool Router can't edit safely."
      );
    }
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function parseOrThrow(text: string): Record<string, unknown> {
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    throw new CodexConfigError("Your Codex config.toml isn't valid TOML.");
  }
}

export function snapshotCodexConfig(text: string | null | undefined): CodexSnapshot {
  if (text && text.trim()) parseOrThrow(text);
  const parsed = splitLines(text);
  assertEditable(parsed.lines);
  const topLevel: CodexSnapshot["topLevel"] = {};
  for (const key of MANAGED_TOP_LEVEL_KEYS) {
    const index = topLevelKeyIndex(parsed.lines, key);
    topLevel[key] = index === -1 ? null : parsed.lines[index];
  }
  const ranges = ourTableRanges(parsed.lines);
  const providerBlock =
    ranges.length > 0
      ? ranges.map(([start, end]) => parsed.lines.slice(start, end).join("\n")).join("\n")
      : null;
  return { topLevel, providerBlock };
}

function setTopLevelLine(lines: string[], key: string, line: string | null) {
  const index = topLevelKeyIndex(lines, key);
  if (line === null) {
    if (index !== -1) lines.splice(index, 1);
    return;
  }
  if (index !== -1) {
    lines[index] = line;
    return;
  }
  // New keys go at the top, before the first table (TOML requires it).
  let insertAt = 0;
  while (insertAt < lines.length && /^\s*#/.test(lines[insertAt])) insertAt++;
  lines.splice(insertAt, 0, line);
}

function removeOurTables(lines: string[]) {
  const ranges = ourTableRanges(lines).reverse();
  for (const [start, end] of ranges) {
    let from = start;
    // Take one blank separator line with the table.
    if (from > 0 && lines[from - 1].trim() === "") from--;
    lines.splice(from, end - from);
  }
}

function appendBlock(lines: string[], block: string[]) {
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length > 0) lines.push("");
  lines.push(...block);
}

/** The config with Codex pointed at Cool Router. */
export function applyCodexConfig(text: string | null | undefined, settings: CodexSettings): string {
  if (text && text.trim()) parseOrThrow(text);
  const parsed = splitLines(text);
  assertEditable(parsed.lines);
  const lines = [...parsed.lines];

  setTopLevelLine(lines, "model", `model = ${tomlString(settings.model)}`);
  setTopLevelLine(lines, "model_provider", `model_provider = ${tomlString(CODEX_PROVIDER_ID)}`);
  const window =
    typeof settings.contextWindow === "number" && settings.contextWindow > 0
      ? Math.floor(settings.contextWindow)
      : null;
  setTopLevelLine(
    lines,
    "model_context_window",
    window ? `model_context_window = ${window}` : null
  );

  removeOurTables(lines);
  appendBlock(lines, [
    `[model_providers.${CODEX_PROVIDER_ID}]`,
    `name = "Cool Router"`,
    `base_url = ${tomlString(settings.baseUrl.replace(/\/+$/, ""))}`,
    `wire_api = "responses"`,
    `experimental_bearer_token = ${tomlString(settings.apiKey)}`,
  ]);

  const result = joinLines({ lines, eol: parsed.eol });
  const check = parseOrThrow(result);
  const provider = (check.model_providers as Record<string, Record<string, unknown>> | undefined)?.[
    CODEX_PROVIDER_ID
  ];
  if (
    check.model !== settings.model ||
    check.model_provider !== CODEX_PROVIDER_ID ||
    provider?.base_url !== settings.baseUrl.replace(/\/+$/, "")
  ) {
    throw new CodexConfigError("Cool Router couldn't edit your Codex config safely.");
  }
  return result;
}

/** Put back exactly what was there before connecting. */
export function restoreCodexConfig(
  text: string | null | undefined,
  snapshot: CodexSnapshot
): string {
  const parsed = splitLines(text);
  const lines = [...parsed.lines];
  for (const key of MANAGED_TOP_LEVEL_KEYS) {
    setTopLevelLine(lines, key, snapshot.topLevel[key] ?? null);
  }
  removeOurTables(lines);
  if (snapshot.providerBlock) appendBlock(lines, snapshot.providerBlock.split("\n"));
  const result = joinLines({ lines, eol: parsed.eol });
  if (result.trim()) parseOrThrow(result);
  return result;
}

/** Is this config pointed at Cool Router with our key? */
export function readCodexConnection(
  text: string | null | undefined,
  apiKey: string | null
): { pointsHere: boolean; baseUrl: string | null; model: string | null } {
  if (!text || !text.trim()) return { pointsHere: false, baseUrl: null, model: null };
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text) as Record<string, unknown>;
  } catch {
    return { pointsHere: false, baseUrl: null, model: null };
  }
  const provider = (
    parsed.model_providers as Record<string, Record<string, unknown>> | undefined
  )?.[CODEX_PROVIDER_ID];
  const baseUrl = typeof provider?.base_url === "string" ? provider.base_url : null;
  return {
    pointsHere:
      parsed.model_provider === CODEX_PROVIDER_ID &&
      Boolean(apiKey) &&
      provider?.experimental_bearer_token === apiKey,
    baseUrl,
    model: typeof parsed.model === "string" ? parsed.model : null,
  };
}
