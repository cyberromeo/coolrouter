# Changelog

All notable changes to Cool Router are documented here.

## [Unreleased]

## [0.1.1] — 2026-11-05

### Added

- **Update checking everywhere.** The dashboard checks GitHub Releases (on load, cached for 6 hours, silent when offline) and shows a dismissible "Cool Router X.Y.Z is available" banner with release notes and the right upgrade steps for Docker or source installs. Opt out with `COOLROUTER_DISABLE_UPDATE_CHECK=1`.
- **Settings → General → Updates**: current version, latest release, how it was installed, and a **Check for updates** button.
- **Desktop auto-update.** The app checks on launch and every 6 hours. Windows and Linux AppImage download updates in the background and offer **Restart to update** (dialog, notification, tray item and in-app banner). macOS and `.deb` builds, which can't replace themselves while unsigned / system-installed, notify and link to the new installer.
- Release workflow also publishes the Windows `.exe.blockmap` for smaller differential updates.

### Changed

- **Password: one first-run flow for every install.** There is no default password any more: the desktop app, Docker and source installs all open a setup wizard that asks you to create one. `INITIAL_PASSWORD` stays as an option for headless deploys and is no longer written into new `.env` files (existing `CHANGEME` installs keep working).
- The login page hint now only appears while `INITIAL_PASSWORD` is in use and no longer claims the default is `123456`; the hidden legacy `123456` fallback was removed.
- `/api/system/version` now reports the latest GitHub release (`current`, `latest`, `updateAvailable`, `release`, `install`, `upgradeCommand`) instead of querying npm; `POST` forces a fresh check. The unused npm/compose self-update code was removed.
- Docs: README and INSTALL cover first-run password and updating per platform; Node requirement aligned with `package.json` (`>=18 <24`, Node 22 recommended); fixed the `cd coolrouter` source instructions and the desktop data-folder table.
- Dependencies: safe minor and patch updates within existing ranges.

### Fixed

- `reset-password` CLI now writes to the real database (`DATA_DIR/storage.sqlite`) and is included in the Docker image (`docker exec -it cool-router node reset-password.mjs`).
- Removed leftover `npx coolrouter` / `npm install -g coolrouter` advice (Cool Router isn't published to npm).
- `docs/openapi.yaml` trimmed to routes that exist.

## [0.1.0] — 2026-11-04

First release of Cool Router.

### Added

- One OpenAI-compatible endpoint for 60+ providers, with Anthropic, Gemini and Ollama formats.
- Combos with 13 routing strategies, including fallback, round-robin, weighted and cost-optimized.
- API keys with per-key model and provider limits.
- Dashboard: Home with copy-paste snippets, Providers, Combos, API Keys, Playground, Usage, Logs and Settings.
- Monochrome UI with Geist Sans/Mono, dark by default, and an AI-designed logo.
- Desktop installers (Windows .exe, macOS .dmg, Linux AppImage/.deb) and a Docker image, built and signed by the release workflow.
- Documentation: install, user guide, API reference, configuration, troubleshooting, releasing.
