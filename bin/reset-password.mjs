#!/usr/bin/env node

/**
 * Password Reset CLI
 *
 * Usage (stop Cool Router first):
 *   node bin/reset-password.mjs                         # source checkout
 *   docker exec -it cool-router node reset-password.mjs # Docker image
 *   DATA_DIR=/path/to/data node bin/reset-password.mjs  # custom data folder
 *
 * Writes a new bcrypt password hash into DATA_DIR/storage.sqlite (settings namespace),
 * the same place the dashboard stores it.
 *
 * @module bin/reset-password
 */

import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import bcrypt from "bcryptjs";

// Resolve the data directory exactly like the server (src/lib/dataPaths.ts).
function resolveDataDir(env = process.env) {
  const configured = env.DATA_DIR?.trim();
  if (configured) return resolve(configured);
  if (process.platform === "win32") {
    const appData = env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "coolrouter");
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(resolve(xdg), "coolrouter");
  return join(homedir(), ".coolrouter");
}

const DATA_DIR = resolveDataDir();
const DB_PATH = join(DATA_DIR, "storage.sqlite");

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function generateSecretDigest(input) {
  // Use bcrypt with a salt round of 10 to match login/route.ts expectations
  // and resolve CodeQL js/insufficient-password-hash warning.
  return bcrypt.hashSync(input, 10);
}

console.log("\n🔑 Cool Router — Password Reset\n");

async function main() {
  // Check if database exists
  if (!existsSync(DB_PATH)) {
    console.error(`❌ Database not found at: ${DB_PATH}`);
    console.error(`   Make sure Cool Router has been started at least once.`);
    console.error(`   Or set DATA_DIR env var to your data directory.\n`);
    process.exit(1);
  }

  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    console.error("❌ better-sqlite3 not installed. Run: npm install");
    process.exit(1);
  }

  const db = new Database(DB_PATH);

  // Check current settings
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'settings' AND key = 'password'")
    .get();

  if (row) {
    console.log("ℹ️  A password is currently set.");
  } else {
    console.log("ℹ️  No password is currently set.");
  }

  const password = await ask("Enter new password (min 4 chars): ");

  if (!password || password.length < 4) {
    console.error("\n❌ Password must be at least 4 characters.\n");
    db.close();
    rl.close();
    process.exit(1);
  }

  const confirm = await ask("Confirm new password: ");

  if (password !== confirm) {
    console.error("\n❌ Passwords do not match.\n");
    db.close();
    rl.close();
    process.exit(1);
  }

  const hashed = generateSecretDigest(password);

  // Upsert the password (values are stored as JSON in key_value)
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', ?, ?)"
  );
  upsert.run("password", JSON.stringify(hashed));
  upsert.run("requireLogin", "true");
  upsert.run("setupComplete", "true");

  db.close();
  rl.close();

  console.log("\n✅ Password reset successfully!");
  console.log("   Restart Cool Router for changes to take effect.\n");
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}\n`);
  rl.close();
  process.exit(1);
});
