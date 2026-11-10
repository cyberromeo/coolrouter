import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-backup-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const backupDb = await import("../../src/lib/db/backup.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function seedConnections(count = 8) {
  const db = core.getDbInstance();
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO provider_connections (id, provider, auth_type, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  for (let index = 0; index < count; index++) {
    insert.run(`backup-conn-${index}`, "openai", "apikey", `backup-${index}`, 1, now, now);
  }
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("backupDbFile creates manual backups and listDbBackups returns metadata", async () => {
  seedConnections(12);

  const result = backupDb.backupDbFile("manual");
  assert.ok(result);

  const backupPath = path.join(core.DB_BACKUPS_DIR, result.filename);
  await waitForFile(backupPath);

  const backups = await backupDb.listDbBackups();

  assert.equal(backups.length >= 1, true);
  assert.equal(backups[0].reason, "manual");
  assert.equal(backups[0].connectionCount, 12);
  assert.equal(fs.existsSync(backupPath), true);
});

test("listDbBackups returns an empty list when the backup directory is missing", async () => {
  fs.rmSync(core.DB_BACKUPS_DIR, { recursive: true, force: true });
  const backups = await backupDb.listDbBackups();
  assert.deepEqual(backups, []);
});

test("restoreDbBackup rejects invalid identifiers and corrupt backup files", async () => {
  await assert.rejects(() => backupDb.restoreDbBackup("../escape.sqlite"), /Invalid backup ID/);

  const missingId = "db_2000-01-01T00-00-00-000Z_manual.sqlite";
  await assert.rejects(() => backupDb.restoreDbBackup(missingId), /Backup not found/);

  fs.mkdirSync(core.DB_BACKUPS_DIR, { recursive: true });
  const corruptId = "db_2001-01-01T00-00-00-000Z_manual.sqlite";
  fs.writeFileSync(path.join(core.DB_BACKUPS_DIR, corruptId), "not a sqlite database");

  await assert.rejects(() => backupDb.restoreDbBackup(corruptId), /Backup file is corrupt/);
});

test("restoreDbBackup restores SQLite contents and returns entity counts", async () => {
  seedConnections(1);

  const backupId = "db_2002-01-01T00-00-00-000Z_manual.sqlite";
  fs.mkdirSync(core.DB_BACKUPS_DIR, { recursive: true });
  await core.getDbInstance().backup(path.join(core.DB_BACKUPS_DIR, backupId));

  core
    .getDbInstance()
    .prepare("DELETE FROM provider_connections WHERE id = ?")
    .run("backup-conn-0");

  const restored = await backupDb.restoreDbBackup(backupId);
  const row = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS cnt FROM provider_connections WHERE id = ?")
    .get("backup-conn-0");

  assert.equal(restored.restored, true);
  assert.equal(restored.backupId, backupId);
  assert.equal(restored.connectionCount, 1);
  assert.equal(restored.nodeCount, 0);
  assert.equal(restored.comboCount, 0);
  assert.equal(restored.apiKeyCount, 0);
  assert.equal(row.cnt, 1);
});

test("manual backup is not skipped while the data still lives in the WAL", async () => {
  // Fresh WAL database: the main file stays at one 4 KB page until the next checkpoint,
  // while the first snapshot is already much larger than that.
  seedConnections(200);

  const first = backupDb.backupDbFile("manual");
  assert.ok(first);
  await waitForFile(path.join(core.DB_BACKUPS_DIR, first.filename));
  assert.equal(first.size > 4096, true, "reported size must be the logical DB size");

  // Second snapshot must not be rejected as "DB shrank" (main file 4 KB vs. previous backup)
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = backupDb.backupDbFile("manual");
  assert.ok(second, "second manual backup was skipped");
  await waitForFile(path.join(core.DB_BACKUPS_DIR, second.filename));
});

test("listDbBackups leaves no -wal/-shm sidecars next to the backups", async () => {
  seedConnections(3);
  const result = backupDb.backupDbFile("manual");
  assert.ok(result);
  await waitForFile(path.join(core.DB_BACKUPS_DIR, result.filename));

  await backupDb.listDbBackups();

  const leftovers = fs
    .readdirSync(core.DB_BACKUPS_DIR)
    .filter((name) => name.endsWith("-wal") || name.endsWith("-shm"));
  assert.deepEqual(leftovers, []);
});

test("restoreDbBackup is not derailed by DB access arriving mid-restore", async () => {
  seedConnections(1);

  const backupId = "db_2003-01-01T00-00-00-000Z_manual.sqlite";
  fs.mkdirSync(core.DB_BACKUPS_DIR, { recursive: true });
  await core.getDbInstance().backup(path.join(core.DB_BACKUPS_DIR, backupId));
  core.getDbInstance().prepare("DELETE FROM provider_connections").run();

  // Stand-in for the auth middleware / a dashboard poll touching the DB while the
  // restore is in flight. It used to reopen the singleton on the old file.
  const timers = [0, 50, 150, 300].map((delay) =>
    setTimeout(() => {
      try {
        core.getDbInstance().prepare("SELECT 1").get();
      } catch {
        /* a closed handle here is fine; reopening the old file is not */
      }
    }, delay)
  );

  try {
    const restored = await backupDb.restoreDbBackup(backupId);
    assert.equal(restored.connectionCount, 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 350));
    timers.forEach(clearTimeout);
  }

  const row = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS cnt FROM provider_connections")
    .get();
  assert.equal(row.cnt, 1, "live connection must point at the restored file");
});

test("importDbFile swaps the live database and returns entity counts", async () => {
  seedConnections(4);

  const uploadPath = path.join(TEST_DATA_DIR, "upload.sqlite");
  await core.getDbInstance().backup(uploadPath);
  core.getDbInstance().prepare("DELETE FROM provider_connections").run();

  const counts = await backupDb.importDbFile(uploadPath);
  assert.deepEqual(counts, { connectionCount: 4, nodeCount: 0, comboCount: 0, apiKeyCount: 0 });

  const row = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS cnt FROM provider_connections")
    .get();
  assert.equal(row.cnt, 4);
});

test("a failed import leaves the live database untouched", async () => {
  seedConnections(3);

  await assert.rejects(() => backupDb.importDbFile(path.join(TEST_DATA_DIR, "missing.sqlite")));

  const row = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS cnt FROM provider_connections")
    .get();
  assert.equal(row.cnt, 3);
  assert.equal(fs.existsSync(`${core.SQLITE_FILE}.incoming`), false);
});
