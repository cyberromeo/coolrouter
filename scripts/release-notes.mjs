#!/usr/bin/env node
/**
 * Print the GitHub release body for a version: its CHANGELOG.md section plus the
 * per-platform install notes people need for unsigned builds.
 *
 * Usage: node scripts/release-notes.mjs v0.1.2 > release-notes.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = String(process.argv[2] || "").replace(/^v/i, "");

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

export function extractChangelogSection(changelog, wanted) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${wanted}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## \[/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const section = extractChangelogSection(changelog, version);

if (!section) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}

const installNotes = `## Installing

| Platform | File |
| --- | --- |
| Windows | \`Cool-Router-${version}-win-x64.exe\` |
| macOS (Apple Silicon) | \`Cool-Router-${version}-mac-arm64.dmg\` |
| macOS (Intel) | \`Cool-Router-${version}-mac-x64.dmg\` |
| Linux | \`Cool-Router-${version}-linux-x86_64.AppImage\` or \`Cool-Router-${version}-linux-amd64.deb\` |
| Docker | \`docker pull ghcr.io/cyberromeo/cool-router:${version}\` |

**macOS** — these builds are not notarized by Apple, so the first launch is blocked with _"Apple could not verify 'Cool Router' is free of malware"_. Open **System Settings → Privacy & Security**, scroll to the message about Cool Router and click **Open Anyway** (once). Or run \`xattr -dr com.apple.quarantine "/Applications/Cool Router.app"\` in Terminal.

**Windows** — the installer is not code-signed yet, so SmartScreen may show _"Windows protected your PC"_. Click **More info → Run anyway**.

Already on 0.1.x? Windows and AppImage installs update themselves; on macOS and \`.deb\`, download the new file and install it over the old one. Your data folder is kept.

Verify downloads with \`SHA256SUMS\` (signed with Sigstore: \`SHA256SUMS.sigstore.json\`).`;

// The changelog links to files in the repo (docs/INSTALL.md#…). A release body has no
// base path, so pin those links to the tagged tree.
const repoBase = `https://github.com/cyberromeo/coolrouter/blob/v${version}/`;
const body = section.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, `](${repoBase}$1)`);

process.stdout.write(`${body}\n\n${installNotes}\n`);
