# Changelog

All notable changes to Cool Router are documented here.

## [Unreleased]

## [0.2.1] — 2026-11-11

A simpler Cool Router: add your providers, choose which of their models answer Opus, Sonnet and Haiku, and connect Claude Code, Claude Desktop or Codex in a click.

### New — three steps instead of nine pages

- **The menu is now Home, Providers, Model map and Connect apps.** Combos, API keys, Playground, Usage and Logs are folded under **Advanced** in the sidebar; nothing was removed.
- **Home** shows the three steps with live status and highlights the next one.
- **Providers**: your connections at the top, and a gallery of every provider grouped by how you pay — Pay per use, Subscriptions, Free, On this computer, Custom URL — with search. Connecting needs one key or one sign-in; the models are fetched automatically. **On this computer** finds Ollama, LM Studio and llama.cpp on their usual ports with nothing to type. The previous all-cards page is still there as **Detailed view**.
- **Model map**: a mind map of your apps, Cool Router and three routes named after Claude's tiers — Opus, Sonnet and Haiku. Drag models to set the order they're tried in, or use the list view. **Arrange for me** fills the routes from your models (most capable on Opus, cheapest on Haiku), and the first provider you connect fills an empty map by itself.
- **Your models answer Claude's names.** Requests for `claude-opus-…`, `claude-sonnet-…` and `claude-haiku-…` (and `opus`, `sonnet`, `haiku`, `auto`) go to the matching route, so Claude Code and Claude Desktop work with any provider. The rules switch on the first time you save the map or connect an app; until then `claude-…` requests route as before. Provider-prefixed names like `cc/claude-…` are never affected.
- **Connect apps**, with a guide for each:
  - **Claude Code** — one click writes `~/.claude/settings.json` (backup kept). Disconnect restores exactly the values that were there.
  - **Claude Desktop** — a setup file to import under Developer → Configure Third-Party Inference, with step-by-step instructions.
  - **Codex** — one click adds a `coolrouter` provider to `~/.codex/config.toml`, pointed at the route you choose; comments and other settings stay.
  - **Any other app** — address, key and SDK/curl snippets.
  - Each app gets its own key, and its card turns **Live** when the app's first message arrives. A changed port is detected and offers an update.

### Fixed — Claude Code through other models

- **Tool use through non-Claude models.** A tool's output reached OpenAI-format models and Gemini as "[No response received]", with the real output pasted as a separate message, so Claude Code's file reads, edits and commands broke on every non-Claude model.
- **Claude Code to the Anthropic API** is now passed through untouched. Before, every request was rewritten through an OpenAI-shaped round trip that dropped thinking, effort, server tools and documents. Claude Code's real user agent (`claude-cli/…`) is now recognised, and its `anthropic-beta` header is forwarded.
- A request that names a newer Claude model (as Claude Code does) is adjusted when a route serves it with an older Claude model: adaptive thinking, effort levels and unsigned thinking from other providers no longer cause 400 errors.
- Anthropic server tools (web search, code execution, …) are no longer offered to other models as empty functions they would call in vain.
- OpenAI: requests use `max_completion_tokens`, and GPT-5 / o-series models no longer receive sampling parameters or replayed reasoning they reject. Groq and Mistral no longer receive replayed reasoning either.
- Codex routed to a Chat Completions provider no longer sends Responses-only fields that strict providers reject.
- A route now moves on to its next model when a model rejects a request for being too long, using an unsupported field, or containing images it can't read.
- A stream that ends without a finish reason still ends the Anthropic message, so Claude Code doesn't wait forever.

### Security

- The new dashboard routes that write app config files or create keys accept only the signed-in dashboard (not a client API key), only same-origin JSON requests, and refuse to write files while the server is reachable from other devices without a password.

## [0.1.2] — 2026-11-10

A bug-fix release. If 0.1.1 would not open on your Mac, or the setup wizard and sign-in seemed to ignore your password, this is the fix.

### Fixed — install and first run

- **macOS: "Cool Router is damaged and can't be opened."** The `.dmg` shipped with no code signature at all, which Apple Silicon refuses outright. Builds are now ad-hoc signed, and the release fails if the signature does not verify. macOS still asks once for confirmation (**System Settings → Privacy & Security → Open Anyway**) because the app is not notarized — see [Install](docs/INSTALL.md#first-launch-on-macos-and-windows).
- **macOS and Linux desktop apps could not start their server.** The bundled server loaded its database driver through a link to a folder on the build machine, so on any other computer it never came up. The bundle is now self-contained, and the release smoke test runs each packaged app with the build tree removed.
- **Setup wizard and sign-in ignored the password.** The wizard saved your password without signing you in, so every later step was rejected and its buttons did nothing; setup was never marked complete, so each sign-in sent you back to the wizard; and on the sign-in page a correct password was accepted but the page did not move on. The wizard now signs you in, reports errors, and both pages are rebuilt. Upgrading from 0.1.1: your password is kept — sign in and the wizard finishes.
- A password shorter than 4 characters was rejected silently; the wizard now says so as you type.
- The wizard's "Google AI" provider could never be added (wrong provider id), and its connection test reported success for an invalid key.
- The session cookie was not persistent, so the desktop app asked for the password on every launch.
- The sign-in page warned that Node.js 24 was unsupported. It is supported; the Node range is now `>=20.9 <25`.

### Fixed — desktop app

- The window now opens immediately on a start-up screen. If the server cannot start you get the reason, **Try again** and **Open logs** instead of a blank window or no window at all.
- macOS: the window could not be dragged (the title bar is hidden and no drag region existed), and the menu-bar icon was drawn at twice its size.
- A server left running by a crashed or force-closed app held the port and, on Windows, locked the install folder so the next update failed. The server now exits with the app, a leftover one is cleaned up at launch, and the Windows installer stops it before copying files.
- If port 20128 is taken by another program the app moves to the next free port instead of showing an error page.
- The app listens on `localhost` only by default, so Windows Firewall no longer prompts on first launch. Turn on **Allow Access from Other Devices** in the tray menu to share it on your network. `localhost` now answers on IPv6 as well as IPv4, so clients that try `::1` first no longer have to fall back.
- The server port chosen in the tray menu is remembered; choosing a busy port is refused with an explanation.
- Links to other sites open in your browser instead of replacing the dashboard inside the app window.
- The Console Logs page was always empty in the installed app (it tried to write under Program Files).
- Linux: closing the window minimizes instead of hiding to a tray that many desktops do not show.
- New: **Reset Dashboard Password…** in the tray and Help menus, a desktop log at `app-logs/desktop.log` in the data folder, and Help → Open Logs / Open Data Folder.
- Installers no longer include the `.env` generated on the build machine (the app always used its own per-install secrets) or the repository's test files.

### Fixed — API

- **Gemini format.** `/v1beta/...` was missing its route (404) and was blocked by the dashboard password. `:generateContent` answered with OpenAI streaming chunks; it now returns Gemini responses, with `:streamGenerateContent`, `:countTokens`, images, system instructions, tool calls and `x-goog-api-key` / `?key=` supported.
- **Responses API.** A plain-string `input` reached the provider as an empty message, and non-streaming requests returned a Chat Completions object. Both fixed.
- **Streaming default.** Leaving `stream` out now returns a single JSON response on Chat Completions, Messages and Responses, as the official APIs do. Previously curl and plain HTTP clients got a stream whenever a format translation was involved.
- **A cached answer could be returned for a different request**: the response cache ignored Responses `input`, Anthropic `system` and the client format.
- **Ollama format.** `/v1/api/chat` lost the reply text and reported errors as HTTP 200; `/api/tags` listed two made-up model names instead of your models.
- `/v1/completions` returns `text_completion` objects; Anthropic-format errors use Anthropic's error shape; an `x-api-key` holding a Cool Router key is honoured on `/v1/messages`.
- Uploads over 10 MB (database import, audio transcription) arrived truncated.

### Fixed — security

- With a password set, anyone who could reach the port could still **replace the dashboard password** and call the **OAuth routes** to attach their own account as a provider. Both now require a signed-in session.
- A dashboard route returned every stored provider credential, decrypted, to the browser.
- Resetting circuit breakers was possible without signing in.
- JSON import stored imported credentials unencrypted.
- **Removed: IP filter (Settings → Security).** Nothing enforced the allow and block lists and they were not saved, so the page gave false assurance. It returns when it is enforced.

### Fixed — backups

- **Backup now** did nothing, **Export All** produced an archive without the database, and restoring a backup failed with a file-lock error on Windows.
- Database import and JSON import now take a real safety backup first, and a failed import no longer damages the current database.
- Automatic backups were switched off for any install whose path contained the letters "test".
- Shutdown and restart from the API were hard kills on Windows, skipping the database checkpoint.

### Fixed — dashboard

- The Home page showed `localhost:20128` as your endpoint whatever address and port the app was served from.
- Several pages crashed when the server answered with a validation error (for example saving API key permissions with no days selected); errors are now shown as text everywhere.
- Buttons that failed silently now report why: the three "Add … Compatible" provider dialogs, combo defaults, combo delete and enable, IP and proxy settings, model aliases, log export.
- Providers: the unlinked "New provider" page could never create a provider; status badges showed raw translation keys; a provider whose only account was banned read "No connections"; tag and validation model could not be cleared.
- Combos: system message, tool filter and cache protection could not be cleared when editing and were dropped when creating.
- Routing settings offered six strategies the server rejects; only working ones are shown, and "strict random" is now accepted.
- Logs: picking a provider also matched every provider whose name contains it; ordinary `provider/model` requests were highlighted as fallbacks and counted in the fallback rate; date format follows your locale.
- Usage: diversity always read 0.0%; chart axis labels were invisible in dark theme and several charts in light theme.
- OAuth sign-in: the callback page said "you can close this tab" even when the app never received the code (always the case in the desktop app); it now shows the URL to paste. Cancelled sign-ins no longer fail a later attempt, and a double click no longer submits the code twice.
- Playground: the "Account / Key" picker had no effect and is replaced by an account count; the first model is selected on load.
- Every page flashed the light theme before switching to dark. Light theme: toasts, banners and several dialogs were unreadable.
- Languages other than English showed raw keys such as `updates.available` for untranslated text; they now fall back to English.
- Dialogs: Escape closes only the top dialog, focus returns to what opened it, and the page behind no longer scrolls when one of two stacked dialogs closes.

### Changed

- Release workflow: a manual run is a dry run that builds everything and publishes nothing; every packaged desktop app is launched once by a smoke test before it can ship; release notes come from this file.
- Docs: install, troubleshooting, API reference and releasing guides updated for all of the above.

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
