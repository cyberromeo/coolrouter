/**
 * Update check against GitHub Releases.
 *
 * Cool Router ships as a Docker image, desktop installers and a source checkout, all
 * versioned by git tags (vX.Y.Z) on github.com/cyberromeo/coolrouter. This module asks the
 * GitHub releases API for the latest published release, caches the answer for six hours,
 * and never throws: offline or rate-limited installs simply report "unknown".
 *
 * Opt out with COOLROUTER_DISABLE_UPDATE_CHECK=1 (no network request is made).
 */
import { existsSync } from "node:fs";
import pkg from "../../../package.json" with { type: "json" };

export const UPDATE_REPO = "cyberromeo/coolrouter";
export const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;
export const DOCKER_IMAGE = "ghcr.io/cyberromeo/cool-router";
const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

export type InstallKind = "docker" | "desktop" | "source";

export type LatestRelease = {
  version: string;
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
};

export type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkDisabled: boolean;
  checkedAt: string | null;
  error: string | null;
  release: LatestRelease | null;
  releasesUrl: string;
  install: InstallKind;
  upgradeCommand: string | null;
};

type CacheEntry = {
  at: number;
  ttl: number;
  release: LatestRelease | null;
  error: string | null;
};

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

export function getCurrentVersion(): string {
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.COOLROUTER_DISABLE_UPDATE_CHECK || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Parse "v1.2.3", "1.2.3" or "1.2.3-beta.1" into comparable parts. */
export function parseVersion(input: string | null | undefined) {
  if (!input) return null;
  const match = String(input)
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || null,
  };
}

/** True when `candidate` is a strictly newer semver than `current`. */
export function isNewerVersion(
  candidate: string | null | undefined,
  current: string | null | undefined
): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  // Same core version: a release beats a prerelease, otherwise not newer.
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true }) > 0;
}

export function detectInstallKind(env: NodeJS.ProcessEnv = process.env): InstallKind {
  const declared = (env.COOLROUTER_INSTALL_KIND || "").trim().toLowerCase();
  if (declared === "docker" || declared === "desktop" || declared === "source") {
    return declared;
  }
  try {
    if (existsSync("/.dockerenv")) return "docker";
  } catch {
    // ignore
  }
  return "source";
}

export function getUpgradeCommand(kind: InstallKind): string | null {
  if (kind === "docker") {
    return `docker pull ${DOCKER_IMAGE}:latest && docker compose up -d`;
  }
  if (kind === "source") {
    return "git pull && npm install && npm run build";
  }
  return null; // the desktop app updates itself (or links to the installer)
}

async function fetchLatestRelease(fetchImpl: typeof fetch): Promise<CacheEntry> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `cool-router/${getCurrentVersion()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        at: Date.now(),
        ttl: FAILURE_TTL_MS,
        release: null,
        error: `GitHub answered ${res.status}`,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    const tag = typeof body.tag_name === "string" ? body.tag_name : "";
    const parsed = parseVersion(tag);
    if (!parsed) {
      return {
        at: Date.now(),
        ttl: FAILURE_TTL_MS,
        release: null,
        error: "Latest release has no version tag",
      };
    }
    const version = tag.replace(/^v/i, "");
    return {
      at: Date.now(),
      ttl: CACHE_TTL_MS,
      error: null,
      release: {
        version,
        tag,
        name: typeof body.name === "string" && body.name ? body.name : `Cool Router ${tag}`,
        url: typeof body.html_url === "string" ? body.html_url : `${RELEASES_URL}/tag/${tag}`,
        publishedAt: typeof body.published_at === "string" ? body.published_at : null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { at: Date.now(), ttl: FAILURE_TTL_MS, release: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function resetUpdateCheckCache() {
  cache = null;
  inflight = null;
}

export async function getUpdateStatus(
  options: { force?: boolean; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<UpdateStatus> {
  const env = options.env || process.env;
  const current = getCurrentVersion();
  const install = detectInstallKind(env);
  const base: UpdateStatus = {
    current,
    latest: null,
    updateAvailable: false,
    checkDisabled: false,
    checkedAt: null,
    error: null,
    release: null,
    releasesUrl: RELEASES_URL,
    install,
    upgradeCommand: getUpgradeCommand(install),
  };

  if (isUpdateCheckDisabled(env)) {
    return { ...base, checkDisabled: true };
  }

  const fresh = cache && Date.now() - cache.at < cache.ttl;
  if (!fresh || options.force) {
    if (!inflight) {
      inflight = fetchLatestRelease(options.fetchImpl || fetch).finally(() => {
        inflight = null;
      });
    }
    const entry = await inflight;
    // Keep a previously known release if a forced/expired re-check fails.
    if (!entry.release && cache?.release) {
      cache = { ...entry, release: cache.release };
    } else {
      cache = entry;
    }
  }

  const entry = cache as CacheEntry;
  const latest = entry.release?.version ?? null;
  return {
    ...base,
    latest,
    release: entry.release,
    error: entry.error,
    checkedAt: new Date(entry.at).toISOString(),
    updateAvailable: isNewerVersion(latest, current),
  };
}
