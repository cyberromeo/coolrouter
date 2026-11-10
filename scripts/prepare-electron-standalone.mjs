#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const STANDALONE_DIR = join(ROOT, ".next", "standalone");
const ELECTRON_STANDALONE_DIR = join(ROOT, ".next", "electron-standalone");
const STATIC_SRC = join(ROOT, ".next", "static");
const STATIC_DEST = join(ELECTRON_STANDALONE_DIR, ".next", "static");
const PUBLIC_SRC = join(ROOT, "public");
const PUBLIC_DEST = join(ELECTRON_STANDALONE_DIR, "public");

function resolveStandaloneBundleDir() {
  const directServer = join(STANDALONE_DIR, "server.js");
  if (existsSync(directServer)) {
    return STANDALONE_DIR;
  }

  const nestedCandidates = [
    join(STANDALONE_DIR, "projects", "Cool Router"),
    join(STANDALONE_DIR, basename(ROOT)),
  ];

  for (const candidate of nestedCandidates) {
    if (existsSync(join(candidate, "server.js"))) {
      return candidate;
    }
  }

  throw new Error(
    `Standalone server bundle not found in ${STANDALONE_DIR}. Run \`npm run build\` first.`
  );
}

function createPathPattern(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\//g, "[\\\\/]");
}

function sanitizeBuildPaths(bundleDir) {
  const buildRoot = ROOT.replace(/\\/g, "/");
  const bundleRoot = bundleDir.replace(/\\/g, "/");
  const replacements = [buildRoot, bundleRoot];
  const targets = [
    join(ELECTRON_STANDALONE_DIR, "server.js"),
    join(ELECTRON_STANDALONE_DIR, ".next", "required-server-files.json"),
  ];

  for (const filePath of targets) {
    if (!existsSync(filePath)) continue;

    let content = readFileSync(filePath, "utf8");
    let updated = content;

    for (const original of replacements) {
      updated = updated.replace(new RegExp(createPathPattern(original), "g"), ".");
    }

    if (updated !== content) {
      writeFileSync(filePath, updated, "utf8");
    }
  }
}

function ensurePackage(pkgPath, sourcePath) {
  if (existsSync(pkgPath) || !existsSync(sourcePath)) return;
  mkdirSync(dirname(pkgPath), { recursive: true });
  cpSync(sourcePath, pkgPath, { recursive: true, dereference: true });
}

function removeGeneratedElectronArtifacts() {
  const generatedDirs = [join(ELECTRON_STANDALONE_DIR, "electron", "dist-electron")];

  for (const dir of generatedDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Next copies every env file it loaded during `next build` into the standalone output.
 * On a build machine that is the `.env` that `npm install` generated — complete with a
 * JWT secret and encryption keys — and it would ship inside every installer. The desktop
 * app generates its own per-install secrets (electron/main.js), so nothing needs these.
 *
 * File tracing also drags in repo-only folders that the server never reads at runtime.
 */
function removeBuildMachineFiles() {
  for (const entry of readdirSync(ELECTRON_STANDALONE_DIR)) {
    if (entry === ".env" || entry.startsWith(".env.")) {
      rmSync(join(ELECTRON_STANDALONE_DIR, entry), { force: true });
      console.log(`[electron] removed ${entry} from the bundle`);
    }
  }

  // "logs" is the build machine's own application log when the app was run from the checkout.
  for (const dir of ["tests", "electron", "logs", ".github", ".husky", ".vscode", "coverage"]) {
    rmSync(join(ELECTRON_STANDALONE_DIR, dir), { recursive: true, force: true });
  }
}

function assertBundleIsPackagable(bundleDir) {
  const nodeModulesPath = join(bundleDir, "node_modules");
  if (!existsSync(nodeModulesPath)) return;

  if (lstatSync(nodeModulesPath).isSymbolicLink()) {
    throw new Error(
      [
        "Next standalone emitted app/node_modules as a symlink.",
        "electron-builder preserves extraResources symlinks, which would make the packaged app",
        "depend on the original build machine path at runtime.",
        "",
        `Offending path: ${nodeModulesPath}`,
        "Use a real node_modules directory in the build worktree before packaging Electron.",
      ].join("\n")
    );
  }
}

function logContextualError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[electron] failed to prepare standalone bundle: ${message}`);
  process.exitCode = 1;
}

process.on("uncaughtException", logContextualError);

const bundleDir = resolveStandaloneBundleDir();
assertBundleIsPackagable(bundleDir);

rmSync(ELECTRON_STANDALONE_DIR, { recursive: true, force: true });
mkdirSync(ELECTRON_STANDALONE_DIR, { recursive: true });

cpSync(bundleDir, ELECTRON_STANDALONE_DIR, {
  recursive: true,
  dereference: true,
});

sanitizeBuildPaths(bundleDir);

if (existsSync(STATIC_SRC)) {
  mkdirSync(dirname(STATIC_DEST), { recursive: true });
  cpSync(STATIC_SRC, STATIC_DEST, { recursive: true, dereference: true });
}

if (existsSync(PUBLIC_SRC)) {
  cpSync(PUBLIC_SRC, PUBLIC_DEST, { recursive: true, dereference: true });
}

removeGeneratedElectronArtifacts();
removeBuildMachineFiles();

ensurePackage(
  join(ELECTRON_STANDALONE_DIR, "node_modules", "@swc", "helpers"),
  join(ROOT, "node_modules", "@swc", "helpers")
);

ensurePackage(
  join(ELECTRON_STANDALONE_DIR, "node_modules", "better-sqlite3"),
  join(ROOT, "node_modules", "better-sqlite3")
);

console.log(
  `[electron] prepared standalone bundle: ${relative(ROOT, ELECTRON_STANDALONE_DIR) || "."}`
);
