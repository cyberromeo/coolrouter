# Releasing

Releases are built entirely by GitHub Actions ([`release.yml`](../.github/workflows/release.yml)).

## Cut a release

1. Bump `version` in `package.json`, `electron/package.json`, `open-sse/package.json` and `docs/openapi.yaml`, and add a section to `CHANGELOG.md`. `npm run check:docs-sync` confirms they match.
2. Commit and push, then do a **dry run**: Actions → **Release** → **Run workflow** on `main`. It builds the Docker image and every desktop installer and smoke-tests each packaged app, but publishes nothing. Fix anything it turns up.
3. Tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow then:

| Job     | Output                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| docker  | `ghcr.io/cyberromeo/cool-router:<version>`, `:<major.minor>`, `:latest` for amd64 and arm64, with SBOM, provenance and a cosign signature |
| desktop | `.dmg` (arm64, x64), `.exe` (NSIS, x64), `.AppImage` and `.deb` (x64), each launched once by `scripts/desktop-smoke-test.mjs`             |
| release | `SHA256SUMS`, Sigstore bundles, build attestations, and a GitHub Release (notes from `CHANGELOG.md`) with every file attached             |

The smoke test starts the packaged app against a throwaway data folder and checks that the server answers, the first-run password flow signs you in, the auth gate holds, and the server stops when the app is killed. Run it locally with `npm run test:desktop` after `electron-builder --dir`.

## Signing

| Artifact         | How it's signed                                   | Needs              |
| ---------------- | ------------------------------------------------- | ------------------ |
| Docker image     | Sigstore cosign, keyless (GitHub OIDC)            | Nothing            |
| Linux, checksums | `cosign sign-blob`, keyless + GitHub attestations | Nothing            |
| macOS `.dmg`     | Apple Developer ID + notarization                 | Repo secrets below |
| Windows `.exe`   | Authenticode                                      | Repo secrets below |

Without the secrets the builds still succeed:

- **macOS** is **ad-hoc signed** by `electron/scripts/after-pack.js`. This matters: a repackaged Electron app with no signature at all is rejected on Apple Silicon as _"damaged and can't be opened"_ with no way around it in the UI. An ad-hoc signature needs no certificate and turns that into the normal _"Apple could not verify…"_ prompt, which users approve once under **Privacy & Security → Open Anyway**. The workflow fails the build if `codesign --verify --deep --strict` does not pass. Only a Developer ID certificate plus notarization removes the prompt entirely.
- **Windows** is unsigned; SmartScreen shows _"Windows protected your PC"_ until the installer is signed or has built up reputation.

### macOS secrets

1. Join the [Apple Developer Program](https://developer.apple.com/programs/).
2. Create a **Developer ID Application** certificate, export it from Keychain as `.p12`.
3. Create an app-specific password at https://account.apple.com.
4. Add repository secrets (Settings → Secrets and variables → Actions):

| Secret                        | Value                       |
| ----------------------------- | --------------------------- |
| `CSC_LINK`                    | `base64 -i cert.p12` output |
| `CSC_KEY_PASSWORD`            | The `.p12` password         |
| `APPLE_ID`                    | Your Apple ID email         |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password   |
| `APPLE_TEAM_ID`               | Your 10-character team ID   |

### Windows secrets

Get a code-signing certificate: [SignPath Foundation](https://signpath.org) is free for open-source projects; otherwise buy an OV certificate from a certificate authority. For a `.pfx` file:

| Secret                 | Value                        |
| ---------------------- | ---------------------------- |
| `WIN_CSC_LINK`         | `base64 -w0 cert.pfx` output |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` password          |

SignPath signs in its own service rather than from a `.pfx`; follow its GitHub Actions guide and replace the Windows signing step.

## Build locally

```bash
npm run build
cd electron && npm install
npm run build:linux     # or build:mac / build:win on that OS
```

Installers land in `electron/dist-electron/`.
