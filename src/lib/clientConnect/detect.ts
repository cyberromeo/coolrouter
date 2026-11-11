/**
 * Is the app installed on this computer? Cached briefly: the check runs the
 * app's --version, which can take a few seconds.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getCliRuntimeStatus } from "@/shared/services/cliRuntime";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: boolean }>();

async function cached(key: string, check: () => Promise<boolean>): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = false;
  try {
    value = await check();
  } catch {
    value = false;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function isClaudeCodeInstalled(): Promise<boolean> {
  return cached("claude", async () => (await getCliRuntimeStatus("claude")).installed === true);
}

export function isCodexInstalled(): Promise<boolean> {
  return cached("codex", async () => (await getCliRuntimeStatus("codex")).installed === true);
}

/** Claude Desktop's usual install locations. */
export function claudeDesktopCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir()
): string[] {
  if (platform === "darwin") {
    return ["/Applications/Claude.app", path.join(home, "Applications", "Claude.app")];
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(local, "AnthropicClaude"),
      path.join(local, "Programs", "Claude"),
      path.join(local, "Claude-3p"),
    ];
  }
  return [path.join(home, ".config", "Claude"), path.join(home, ".config", "Claude-3p")];
}

export function isClaudeDesktopInstalled(): Promise<boolean> {
  return cached("claude-desktop", async () =>
    claudeDesktopCandidates().some((p) => fs.existsSync(p))
  );
}

export function clearDetectionCache() {
  cache.clear();
}
