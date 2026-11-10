# Troubleshooting

## Quick fixes

| Problem                                            | Fix                                                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can't sign in the first time                       | There's no default password: finish the setup wizard. If `INITIAL_PASSWORD` is set (env or `.env`; 0.1.0 source installs used `CHANGEME`), sign in with it                          |
| Forgot the dashboard password                      | Desktop app: tray menu → **Reset Dashboard Password…**. Source: stop Cool Router, then `node bin/reset-password.mjs`. Docker: `docker exec -it cool-router node reset-password.mjs` |
| Blank login page or "Module did not self-register" | The SQLite driver was built for another Node.js version. Use Node 20.9–24 (22 LTS recommended) and run `npm rebuild better-sqlite3`                                                 |
| `EACCES: permission denied`                        | Point `DATA_DIR` at a folder you can write to                                                                                                                                       |
| Port 20128 already in use                          | Set `PORT` to another port, or stop the other process. The desktop app switches to the next free port by itself (tray menu → **Server Port**)                                       |
| `No credentials for provider: X`                   | Connect provider X on the Providers page, or use a model you have connected                                                                                                         |
| `Invalid API key`                                  | The key must be created on the API Keys page. Check for stray spaces                                                                                                                |
| `Missing API key`                                  | `REQUIRE_API_KEY=true` is on; send `Authorization: Bearer <key>`                                                                                                                    |
| macOS: "Apple could not verify…"                   | System Settings → Privacy & Security → **Open Anyway**, see [Install](INSTALL.md#first-launch-on-macos-and-windows)                                                                 |
| macOS: "Cool Router is damaged"                    | A 0.1.0/0.1.1 bug on Apple Silicon. Install 0.1.2 or later, see [Install](INSTALL.md#first-launch-on-macos-and-windows)                                                             |
| SmartScreen warning on Windows                     | More info → Run anyway, see [Install](INSTALL.md#first-launch-on-macos-and-windows)                                                                                                 |
| Setup wizard or sign-in "does nothing"             | A 0.1.1 bug (the wizard saved the password without signing you in). Update to 0.1.2; your password is kept — sign in and the wizard finishes                                        |
| Desktop app shows "couldn't start"                 | Read the reason on that screen, click **Open logs** (`app-logs/desktop.log` in the data folder), then **Try again**                                                                 |
| Another device can't reach the desktop app         | It listens on localhost only by default: tray menu → **Allow Access from Other Devices**                                                                                            |

## Providers

**Connection test fails with "fetch failed".** The server can't reach the provider. Check your internet connection and any corporate proxy. If you need a proxy, set it in **Settings → Advanced** or with `HTTPS_PROXY`.

**OAuth sign-in redirects to the wrong address.** Behind a reverse proxy, set `NEXT_PUBLIC_BASE_URL` to your public URL so the callback comes back to the right place.

**OAuth token expired.** Cool Router refreshes tokens in the background. If a connection still shows expired, open it and reconnect.

**Rate limited (429).** Add a second account or key for the provider, or put the model in a combo with a fallback. Cool Router skips rate-limited accounts until they recover.

**A provider keeps failing and gets skipped.** After repeated errors a provider is paused briefly (circuit breaker) and retried automatically. Fix the connection, then use **Test** on the Providers page.

## Requests

**Model not found.** Use the exact id from `GET /v1/models`, in `provider/model` form, or a combo name.

**Streaming stops halfway.** A proxy in front of Cool Router may be buffering. For nginx add `proxy_buffering off;` and a long `proxy_read_timeout`. You can also raise `STREAM_IDLE_TIMEOUT_MS`.

**Session header ignored behind nginx.** If you send `x_session_id` with an underscore, enable `underscores_in_headers on;`, or use `X-Session-Id`.

## Docker

**Settings vanish after a restart.** Mount a volume at `/app/data`, as in the `docker run` example in [Install](INSTALL.md#docker).

**Container is unhealthy.** Run `docker logs cool-router`. The health check calls the local server, so a crash on start (often a bad `.env`) shows there.

## Debugging

- Set `APP_LOG_LEVEL=debug`, restart, and read `logs/application/app.log` in the folder Cool Router runs from (desktop app: `app-logs/` in the data folder, or **Help → Open Logs**).
- The **Logs** page shows each request's status, provider, account and timing. Click a row for full details.
- Still stuck? Open an issue at https://github.com/cyberromeo/coolrouter/issues with the error, your OS, Node version and how you installed.
