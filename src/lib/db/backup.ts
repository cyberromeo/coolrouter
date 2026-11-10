/**
 * db/backup.js — Database backup/restore operations.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  getDbInstance,
  resetDbInstance,
  isBuildPhase,
  isCloud,
  SQLITE_FILE,
  DB_BACKUPS_DIR,
  DATA_DIR,
} from "./core";
import { resetAllDbModuleState } from "./stateReset";
import { invalidateDbCache } from "./readCache";

type CountRow = { cnt?: number };

// ──────────────── Backup Config ────────────────

// Throttle state lives on globalThis: Next bundles this module separately for the route
// handlers, the proxy middleware and instrumentation, and with a module-level variable each
// copy took its own "hourly" snapshot within seconds of the others.
declare global {
  var __coolrouterLastDbBackupAt: number | undefined;
}

function getLastBackupAt(): number {
  return globalThis.__coolrouterLastDbBackupAt ?? 0;
}

function setLastBackupAt(at: number) {
  globalThis.__coolrouterLastDbBackupAt = at;
}
const BACKUP_THROTTLE_MS = 60 * 60 * 1000; // 60 minutes
const MAX_DB_BACKUPS = 20;
const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function isSqliteAutoBackupDisabled() {
  // Detect an actual test run. This used to be `argv.some(a => a.includes("test"))`, which
  // also matched any install or checkout path containing those letters (C:\Users\tester\…,
  // /srv/coolrouter/latest/…) and silently switched off every automatic backup there.
  const isTest =
    typeof process !== "undefined" &&
    (process.env.NODE_ENV === "test" ||
      process.env.VITEST !== undefined ||
      process.env.NODE_TEST_CONTEXT !== undefined ||
      process.execArgv.some((a) => a === "--test" || a.startsWith("--test=")) ||
      process.argv.slice(1).some((a) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(a)));
  if (isTest) return true;

  const value = process.env.DISABLE_SQLITE_AUTO_BACKUP;
  if (!value) return false;
  return TRUE_ENV_VALUES.has(value.trim().toLowerCase());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function unlinkFileWithRetry(
  filePath: string,
  options?: { maxAttempts?: number; retryableCodes?: string[]; baseDelayMs?: number }
) {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 10);
  const retryableCodes = new Set(options?.retryableCodes ?? ["EBUSY", "EPERM"]);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 100);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : "";
      if (code === "ENOENT") return;
      if (retryableCodes.has(String(code)) && attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
}

/** Block the thread for `ms` — only for the short, deliberately synchronous DB swap below. */
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run a filesystem operation, retrying on EBUSY/EPERM without yielding to the event loop
 * (Windows can hold a just-closed file for a moment: antivirus, indexer). Same policy as
 * unlinkFileWithRetry, but synchronous so the DB swap below cannot be interleaved.
 */
function retrySyncWhileBusy(operation: () => void, maxAttempts = 10, baseDelayMs = 100) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      operation();
      return;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : "";
      if ((code === "EBUSY" || code === "EPERM") && attempt < maxAttempts - 1) {
        sleepSync(baseDelayMs * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Logical size of the live database in bytes (page_count × page_size).
 *
 * In WAL mode the main file can stay at a single 4 KB page until the next checkpoint
 * while all the data lives in storage.sqlite-wal, so the on-disk size of the main file
 * says nothing about how much data a backup would contain.
 */
export function getLiveDbSizeBytes(fileSizeBytes: number): number {
  try {
    const db = getDbInstance();
    const pageCount = Number(db.pragma("page_count", { simple: true }));
    const pageSize = Number(db.pragma("page_size", { simple: true }));
    const logicalSize = pageCount * pageSize;
    return Number.isFinite(logicalSize) && logicalSize > fileSizeBytes
      ? logicalSize
      : fileSizeBytes;
  } catch {
    return fileSizeBytes;
  }
}

/**
 * Opening a backup read-only leaves `-shm` / empty `-wal` sidecars next to it (the
 * snapshot header says WAL, and a read-only connection cannot remove them on close).
 * Nothing ever reads or rotates them, so drop them once the handle is closed.
 */
function removeStaleSidecars(sqlitePath: string) {
  try {
    const walPath = `${sqlitePath}-wal`;
    if (fs.existsSync(walPath)) {
      if (fs.statSync(walPath).size > 0) return; // real WAL content: leave everything alone
      fs.unlinkSync(walPath);
    }
    const shmPath = `${sqlitePath}-shm`;
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  } catch {
    /* best effort */
  }
}

/**
 * Create a snapshot right now and wait until it is completely written.
 *
 * backupDbFile() only *starts* a backup (and throttles it), which is useless as a safety
 * net in front of a destructive operation: the connection is closed, or the data already
 * rewritten, before the first page is copied. Restore/import flows use this instead.
 * Honors DISABLE_SQLITE_AUTO_BACKUP like the other automatic backups.
 */
export async function createDbBackupAndWait(reason: string): Promise<string | null> {
  if (isBuildPhase || isCloud) return null;
  if (isSqliteAutoBackupDisabled()) return null;
  if (!SQLITE_FILE || !fs.existsSync(SQLITE_FILE)) return null;
  if (getLiveDbSizeBytes(fs.statSync(SQLITE_FILE).size) < 4096) return null;

  const backupDir = DB_BACKUPS_DIR || path.join(DATA_DIR, "db_backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(
    backupDir,
    `db_${new Date().toISOString().replace(/[:.]/g, "-")}_${reason}.sqlite`
  );
  await getDbInstance().backup(backupPath);
  setLastBackupAt(Date.now());
  console.log(`[DB] Backup created: ${backupPath}`);
  return backupPath;
}

// ──────────────── Backup ────────────────

export function backupDbFile(reason = "auto") {
  try {
    if (isBuildPhase || isCloud) return null;
    if (!SQLITE_FILE || !fs.existsSync(SQLITE_FILE)) return null;
    if (reason !== "manual" && isSqliteAutoBackupDisabled()) return null;

    const dbSize = getLiveDbSizeBytes(fs.statSync(SQLITE_FILE).size);
    if (dbSize < 4096) {
      console.warn(`[DB] Backup SKIPPED — DB too small (${dbSize}B)`);
      return null;
    }

    // Throttle
    const now = Date.now();
    if (
      reason !== "manual" &&
      reason !== "pre-restore" &&
      now - getLastBackupAt() < BACKUP_THROTTLE_MS
    )
      return null;
    setLastBackupAt(now);

    const backupDir = DB_BACKUPS_DIR || path.join(DATA_DIR, "db_backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    // Shrink check vs latest backup. An explicit "Backup now" is never skipped: backups are
    // separate files, so a smaller snapshot cannot overwrite a larger one.
    const existingBackups = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("db_") && f.endsWith(".sqlite"))
      .sort();
    if (reason !== "manual" && existingBackups.length > 0) {
      const latestBackup = existingBackups[existingBackups.length - 1];
      const latestStat = fs.statSync(path.join(backupDir, latestBackup));
      if (latestStat.size > 4096 && dbSize < latestStat.size * 0.5) {
        console.warn(`[DB] Backup SKIPPED — DB shrank from ${latestStat.size}B to ${dbSize}B`);
        return null;
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupDir, `db_${timestamp}_${reason}.sqlite`);

    // Use native SQLite backup API for consistency
    const db = getDbInstance();
    db.backup(backupFile)
      .then(() => {
        console.log(`[DB] Backup created: ${backupFile} (${dbSize} bytes)`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[DB] Backup failed:", message);
      });

    // Rotation — keep only last N, delete smallest first
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("db_") && f.endsWith(".sqlite"))
      .sort();
    while (files.length > MAX_DB_BACKUPS) {
      let smallestIdx = 0;
      let smallestSize = Infinity;
      for (let i = 0; i < files.length - 1; i++) {
        try {
          const fStat = fs.statSync(path.join(backupDir, files[i]));
          if (fStat.size < smallestSize) {
            smallestSize = fStat.size;
            smallestIdx = i;
          }
        } catch {
          smallestIdx = i;
          break;
        }
      }
      try {
        fs.unlinkSync(path.join(backupDir, files[smallestIdx]));
      } catch {
        /* gone */
      }
      removeStaleSidecars(path.join(backupDir, files[smallestIdx]));
      files.splice(smallestIdx, 1);
    }

    return { filename: path.basename(backupFile), size: dbSize };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DB] Backup failed:", message);
    return null;
  }
}

// ──────────────── List Backups ────────────────

export async function listDbBackups() {
  const backupDir = DB_BACKUPS_DIR || path.join(DATA_DIR, "db_backups");
  try {
    if (!fs.existsSync(backupDir)) return [];

    const entries = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("db_") && f.endsWith(".sqlite"))
      .sort()
      .reverse();

    return entries.map((filename) => {
      const filePath = path.join(backupDir, filename);
      const stat = fs.statSync(filePath);
      const match = filename.match(/^db_(.+?)_([^.]+)\.sqlite$/);
      const reason = match ? match[2] : "unknown";

      let connectionCount = 0;
      let backupDb: InstanceType<typeof Database> | null = null;
      try {
        backupDb = new Database(filePath, { readonly: true });
        const row = backupDb.prepare("SELECT COUNT(*) as cnt FROM provider_connections").get() as
          CountRow | undefined;
        connectionCount = row?.cnt || 0;
      } catch {
        /* ignore */
      } finally {
        // Always release the handle: a leaked one keeps the file locked on Windows, so a
        // corrupt or half-written backup could never be rotated or deleted.
        try {
          backupDb?.close();
        } catch {
          /* ignore */
        }
        removeStaleSidecars(filePath);
      }

      return {
        id: filename,
        filename,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
        reason,
        connectionCount,
      };
    });
  } catch {
    return [];
  }
}

// ──────────────── Restore Backup ────────────────

export async function restoreDbBackup(backupId: string) {
  const backupDir = DB_BACKUPS_DIR || path.join(DATA_DIR, "db_backups");

  // Validate format: must be db_<timestamp>_<reason>.sqlite, no path separators
  if (
    !backupId.startsWith("db_") ||
    !backupId.endsWith(".sqlite") ||
    backupId.includes(path.sep) ||
    backupId.includes("/")
  ) {
    throw new Error("Invalid backup ID");
  }

  const backupPath = path.resolve(backupDir, backupId);
  // Prevent path traversal: resolved path must stay within backupDir
  if (
    !backupPath.startsWith(path.resolve(backupDir) + path.sep) &&
    backupPath !== path.resolve(backupDir)
  ) {
    throw new Error("Invalid backup ID: path traversal detected");
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  // Validate backup integrity
  let testDb: InstanceType<typeof Database> | null = null;
  try {
    testDb = new Database(backupPath, { readonly: true });
    const result = testDb.pragma("integrity_check") as Array<{ integrity_check?: string }>;
    if (result[0]?.integrity_check !== "ok") {
      throw new Error("Backup integrity check failed");
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "Backup integrity check failed") throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Backup file is corrupt: ${message}`);
  } finally {
    // Release the handle on every path; a leaked one keeps the file locked on Windows.
    try {
      testDb?.close();
    } catch {
      /* ignore */
    }
    removeStaleSidecars(backupPath);
  }

  // Pre-restore backup, awaited so the DB is not closed while the backup runs
  await createDbBackupAndWait("pre-restore");

  const counts = replaceLiveDbFile(backupPath);

  console.log(`[DB] Restored backup: ${backupId} (${counts.connectionCount} connections)`);

  return { restored: true, backupId, ...counts };
}

/**
 * Replace the live database with a validated .sqlite upload (POST /api/db-backups/import).
 * Takes an awaited pre-import snapshot first, then swaps the file the same way a restore does.
 */
export async function importDbFile(sourcePath: string) {
  await createDbBackupAndWait("pre-import");
  return replaceLiveDbFile(sourcePath);
}

/**
 * Close the live connection, swap storage.sqlite for `sourcePath`, and reopen.
 * Shared by restore and import so both get the Windows-safe unlink and the state reset.
 *
 * Everything between close and reopen is synchronous on purpose. Any DB access that gets
 * to run in between (the auth middleware reads settings on every request, the dashboard
 * polls, schedulers tick) would lazily reopen the singleton on the *old* file: on Windows
 * the unlink then fails with EBUSY and the restore errors out, on POSIX the process keeps
 * writing to the unlinked file and the restored data only shows up after a restart.
 */
function replaceLiveDbFile(sourcePath: string) {
  const sqliteFile = SQLITE_FILE;
  if (!sqliteFile) {
    throw new Error("SQLITE_FILE is unavailable in local backup restore");
  }

  // Stage the replacement next to the live file first. Everything that can realistically
  // fail (unreadable source, full disk) fails here, before the current database is touched.
  const stagedFile = `${sqliteFile}.incoming`;
  fs.copyFileSync(sourcePath, stagedFile);

  try {
    // Close and reset current connection (checkpoints the WAL into the main file)
    resetDbInstance();

    // Clear all cached prepared statements and other state bound to the old connection
    resetAllDbModuleState();
    // ...and the TTL read caches, so settings/connections of the replaced DB are not served
    invalidateDbCache();

    // Drop the sidecars so no stale WAL frames are replayed over the replacement.
    for (const sidecar of [`${sqliteFile}-wal`, `${sqliteFile}-shm`, `${sqliteFile}-journal`]) {
      retrySyncWhileBusy(() => {
        if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      });
    }

    // Atomically swap the main file. If this fails the old database is still complete.
    retrySyncWhileBusy(() => fs.renameSync(stagedFile, sqliteFile));
  } catch (err) {
    try {
      if (fs.existsSync(stagedFile)) fs.unlinkSync(stagedFile);
    } catch {
      /* best effort */
    }
    throw err;
  }

  // Reopen
  const db = getDbInstance();
  const connCount =
    (db.prepare("SELECT COUNT(*) as cnt FROM provider_connections").get() as CountRow | undefined)
      ?.cnt || 0;
  const nodeCount =
    (db.prepare("SELECT COUNT(*) as cnt FROM provider_nodes").get() as CountRow | undefined)?.cnt ||
    0;
  const comboCount =
    (db.prepare("SELECT COUNT(*) as cnt FROM combos").get() as CountRow | undefined)?.cnt || 0;
  const keyCount =
    (db.prepare("SELECT COUNT(*) as cnt FROM api_keys").get() as CountRow | undefined)?.cnt || 0;

  return {
    connectionCount: connCount,
    nodeCount,
    comboCount,
    apiKeyCount: keyCount,
  };
}
