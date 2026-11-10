/**
 * electron-builder afterPack hook — ad-hoc sign unsigned macOS builds.
 *
 * Without an Apple Developer ID certificate electron-builder skips code signing
 * entirely. Repackaging Electron (renaming it, adding resources) invalidates the
 * signature the prebuilt Electron binaries shipped with, and macOS refuses to run an
 * arm64 app whose signature is missing or broken: Gatekeeper reports
 *   "Cool Router" is damaged and can't be opened. You should move it to the Trash.
 * with no way to open it from the UI.
 *
 * An ad-hoc signature (identity "-") costs nothing and needs no certificate. It makes
 * the bundle valid again, so a downloaded build gets the ordinary "Apple could not
 * verify…" prompt, which the user can approve under System Settings → Privacy &
 * Security → Open Anyway. (Removing that prompt needs a Developer ID + notarization;
 * see docs/RELEASING.md. When those secrets are present this hook does nothing.)
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MACH_O_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
]);

function isMachO(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const header = Buffer.alloc(4);
    if (fs.readSync(fd, header, 0, 4, 0) !== 4) return false;
    return MACH_O_MAGICS.has(header.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Mach-O files (the bundled `node`, native `.node` addons, dylibs) under a directory. */
function findMachOFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) findMachOFiles(full, found);
    else if (entry.isFile() && isMachO(full)) found.push(full);
  }
  return found;
}

/**
 * Remove symlinks that point outside the app bundle, to an absolute path, or nowhere.
 *
 * macOS refuses to seal such a bundle ("invalid destination for symbolic link in
 * bundle"), with an ad-hoc identity and with a Developer ID alike. They come from the
 * server's node_modules — typically node-gyp's `build/node_gyp_bins/python3`, an absolute
 * link to the build machine's Python — and nothing uses them at runtime.
 */
function removeInvalidSymlinks(dir, bundleRoot, removed = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      const resolved = path.resolve(path.dirname(full), target);
      const inside = resolved === bundleRoot || resolved.startsWith(bundleRoot + path.sep);
      if (path.isAbsolute(target) || !inside || !fs.existsSync(resolved)) {
        fs.rmSync(full, { force: true });
        removed.push(`${path.relative(bundleRoot, full)} -> ${target}`);
      }
    } else if (entry.isDirectory()) {
      removeInvalidSymlinks(full, bundleRoot, removed);
    }
  }
  return removed;
}

function codesign(args) {
  execFileSync("codesign", args, { stdio: ["ignore", "pipe", "pipe"] });
}

function willSignWithCertificate(context) {
  const macOptions = context.packager?.platformSpecificBuildOptions || {};
  // `identity: null` (what the release workflow passes when there is no certificate)
  // turns signing off no matter what the environment holds.
  if (macOptions.identity === null) return false;
  return Boolean(process.env.CSC_LINK || process.env.CSC_NAME || macOptions.identity);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.platform !== "darwin") return; // codesign only exists on macOS

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) {
    throw new Error(`after-pack: app bundle not found at ${appPath}`);
  }
  const resourcesDir = path.join(appPath, "Contents", "Resources");

  // Needed whichever identity signs the bundle.
  // Walk the real path so "inside the bundle" is compared like with like (/tmp is itself
  // a symlink on macOS).
  const realAppPath = fs.realpathSync(appPath);
  const removedLinks = removeInvalidSymlinks(
    path.join(realAppPath, "Contents", "Resources"),
    realAppPath
  );
  for (const link of removedLinks) {
    console.log(`  • after-pack: removed symlink that would break signing: ${link}`);
  }

  if (willSignWithCertificate(context)) {
    console.log(
      "  • after-pack: a signing identity is configured — leaving signing to electron-builder"
    );
    return;
  }

  // Inside-out: loose executables in Resources first (codesign --deep only descends into
  // standard nested-code locations such as Frameworks), then the bundle itself.
  const looseBinaries = findMachOFiles(resourcesDir);
  for (const file of looseBinaries) {
    codesign(["--force", "--sign", "-", "--timestamp=none", file]);
  }

  codesign(["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);

  // Fail the build here rather than ship another bundle macOS will call "damaged".
  codesign(["--verify", "--deep", "--strict", appPath]);

  console.log(
    `  • after-pack: ad-hoc signed ${appName} (${looseBinaries.length} bundled binaries + app bundle)`
  );
};
