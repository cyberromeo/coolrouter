# Install Cool Router

Pick whichever fits. Every option serves the dashboard and the API on **http://localhost:20128**.

## Desktop app (macOS, Windows, Linux)

Download the latest installer from **[Releases](https://github.com/cyberromeo/coolrouter/releases/latest)**.

| OS              | File                                                                            | How to install                                                |
| --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| macOS           | `Cool-Router-<version>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel) | Open the `.dmg`, drag **Cool Router** to Applications         |
| Windows         | `Cool-Router-<version>-win-x64.exe`                                             | Run the installer and follow the steps                        |
| Linux           | `Cool-Router-<version>-linux-x86_64.AppImage`                                   | `chmod +x Cool-Router-*.AppImage && ./Cool-Router-*.AppImage` |
| Debian / Ubuntu | `Cool-Router-<version>-linux-amd64.deb`                                         | `sudo apt install ./Cool-Router-*.deb`                        |

The app runs the gateway in the background, opens the dashboard in its own window and keeps an icon in the tray or menu bar. Closing the window keeps the gateway running; quit from the tray icon.

### Unsigned builds

Until the project's signing certificates are in place, macOS and Windows may warn on first launch:

- **macOS**: right-click the app in Applications → **Open** → **Open**. Or run `xattr -dr com.apple.quarantine "/Applications/Cool Router.app"`.
- **Windows**: SmartScreen → **More info** → **Run anyway**.

Signed releases install without these prompts.

## Docker

```bash
docker run -d --name cool-router \
  -p 20128:20128 \
  -v cool-router-data:/app/data \
  --restart unless-stopped \
  ghcr.io/cyberromeo/cool-router:latest
```

Or with Compose, from a clone of this repo:

```bash
cp .env.example .env    # optional: secrets, INITIAL_PASSWORD for headless deploys
docker compose up -d
```

Images are published for `linux/amd64` and `linux/arm64`. All data lives in the `cool-router-data` volume.

## From source

Requires Node.js 18, 20 or 22 (`>=18 <24`; Node 22 LTS recommended, Node 24 isn't supported yet).

```bash
git clone https://github.com/cyberromeo/coolrouter.git
cd coolrouter
npm install          # also creates .env with fresh secrets
npm run build
npm start
```

For development with hot reload, use `npm run dev` instead of build + start.

## First run and your password

There is no built-in default password. Every install path works the same way:

| Install                                                          | First launch                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Desktop app                                                      | The setup wizard opens and asks you to create a password                      |
| Docker (`docker run` / Compose without `INITIAL_PASSWORD`)       | Open http://localhost:20128, the setup wizard asks you to create a password   |
| Source (`npm install && npm run build && npm start`)             | Same setup wizard                                                             |
| Any of the above with `INITIAL_PASSWORD` set (env var or `.env`) | No wizard: sign in with that value, then change it in **Settings → Security** |

1. Open http://localhost:20128 and create your password in the wizard (or sign in with `INITIAL_PASSWORD` if you set one).
2. Follow the **Get started** steps on the Home page.

Set the password before exposing the port to other machines: until the wizard is finished, the dashboard is open to whoever reaches it first. For a server, pass `-e INITIAL_PASSWORD=...` to `docker run` (or set it in `.env`) so it starts locked.

> **Upgrading from 0.1.0:** source installs created `.env` with `INITIAL_PASSWORD=CHANGEME`. That still works: sign in with `CHANGEME` (the login page reminds you), then set your own password. Once a password is saved in Settings, `INITIAL_PASSWORD` is ignored.

**Forgot it?** Stop Cool Router and run `node bin/reset-password.mjs` (source) or `docker exec -it cool-router node reset-password.mjs` (Docker). Set `DATA_DIR` if your data folder isn't the default.

## Updating

The dashboard checks GitHub Releases on launch and every 6 hours and shows a banner when a new version is out; **Settings → General → Updates** has a **Check for updates** button. Set `COOLROUTER_DISABLE_UPDATE_CHECK=1` to turn it off.

- **Windows** and **Linux AppImage**: the app downloads the update in the background and offers **Restart to update**.
- **macOS** and **Linux .deb**: unsigned macOS builds and system packages can't replace themselves, so you get a notification and a banner linking to the new installer. Install it over the old one; your data is kept.
- **Docker**: `docker pull ghcr.io/cyberromeo/cool-router:latest`, then `docker compose up -d` (or remove and re-run the container with the same volume).
- **Source**: `git pull && npm install && npm run build`, then restart.

## Verify your download

Every release includes `SHA256SUMS`, Sigstore signature bundles (`*.sigstore.json`) and GitHub build provenance.

```bash
# Checksums
sha256sum -c SHA256SUMS --ignore-missing

# Sigstore signature (Linux packages and SHA256SUMS)
cosign verify-blob SHA256SUMS \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp 'https://github.com/cyberromeo/coolrouter/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# GitHub provenance (any file)
gh attestation verify Cool-Router-0.1.0-linux-x86_64.AppImage --repo cyberromeo/coolrouter

# Docker image signature
cosign verify ghcr.io/cyberromeo/cool-router:0.1.0 \
  --certificate-identity-regexp 'https://github.com/cyberromeo/coolrouter/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Where your data lives

| Install                          | Data directory                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Source, desktop on macOS / Linux | `~/.coolrouter` (or `$XDG_CONFIG_HOME/coolrouter` when set; override with `DATA_DIR`) |
| Source or desktop on Windows     | `%APPDATA%\coolrouter`                                                                |
| Docker                           | `/app/data` inside the container (the volume)                                         |

Back it up from **Settings → General → Backup**.

## Uninstall

- **macOS**: drag the app to the Bin. **Windows**: Settings → Apps → Cool Router → Uninstall. **Linux**: delete the AppImage, or `sudo apt remove cool-router-desktop`.
- **Docker**: `docker rm -f cool-router && docker volume rm cool-router-data`.
- Delete the data directory above to remove all settings and keys.
