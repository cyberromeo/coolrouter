# Configuration

Cool Router reads environment variables from `.env` in the project folder (or `~/.coolrouter/.env`), then from the process environment. `npm install` creates `.env` with fresh secrets; `.env.example` lists everything.

Most people only touch the first table.

## Essentials

| Variable                          | Default                  | What it does                                                                                                                                                                              |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                            | `20128`                  | Port for the dashboard and the API                                                                                                                                                        |
| `INITIAL_PASSWORD`                | unset                    | Optional. Unset: the first-run wizard asks you to create a password. Set: the dashboard starts locked with this password (for headless deploys) until you save one in Settings → Security |
| `COOLROUTER_DISABLE_UPDATE_CHECK` | unset                    | `1` stops the GitHub Releases update check (dashboard and desktop app)                                                                                                                    |
| `DATA_DIR`                        | `~/.coolrouter`          | Where the database, logs and backups live                                                                                                                                                 |
| `REQUIRE_API_KEY`                 | `false`                  | `true` rejects `/v1` requests without a valid Cool Router key                                                                                                                             |
| `BASE_URL`                        | `http://localhost:20128` | This instance's own URL, used by background jobs                                                                                                                                          |
| `NEXT_PUBLIC_BASE_URL`            | unset                    | Public URL when behind a reverse proxy; also the OAuth callback origin                                                                                                                    |

## Secrets

Generated automatically on first install. Keep them stable: changing `STORAGE_ENCRYPTION_KEY` makes saved provider credentials unreadable.

| Variable                 | Purpose                                 | Generate with             |
| ------------------------ | --------------------------------------- | ------------------------- |
| `JWT_SECRET`             | Signs dashboard sessions                | `openssl rand -base64 48` |
| `API_KEY_SECRET`         | Signs Cool Router API keys              | `openssl rand -hex 32`    |
| `STORAGE_ENCRYPTION_KEY` | Encrypts provider credentials in SQLite | `openssl rand -hex 32`    |

## Security

| Variable               | Default | What it does                                     |
| ---------------------- | ------- | ------------------------------------------------ |
| `AUTH_COOKIE_SECURE`   | `false` | Set `true` when serving the dashboard over HTTPS |
| `ALLOW_API_KEY_REVEAL` | `false` | Allow showing full API keys again after creation |
| `CORS_ORIGIN`          | `*`     | Allowed browser origins for the API              |

## Network

| Variable                                             | What it does                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `API_PORT`, `API_HOST`, `DASHBOARD_PORT`             | Serve the API and dashboard on separate ports                                                             |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | Upstream proxy for provider calls (SOCKS5 supported). Can also be set per provider in Settings → Advanced |
| `REQUEST_TIMEOUT_MS`                                 | Overall upstream request timeout (default 10 minutes)                                                     |
| `STREAM_IDLE_TIMEOUT_MS`                             | Abort a stream after this long with no data                                                               |

## Logs and storage

| Variable                     | Default | What it does                                |
| ---------------------------- | ------- | ------------------------------------------- |
| `APP_LOG_LEVEL`              | `info`  | `debug`, `info`, `warn` or `error`          |
| `APP_LOG_TO_FILE`            | `false` | Also write logs to `DATA_DIR/logs`          |
| `CALL_LOG_RETENTION_DAYS`    | `90`    | How long request logs are kept              |
| `CALL_LOG_MAX_ENTRIES`       | `10000` | Cap on stored request logs                  |
| `SQLITE_MAX_SIZE_MB`         | `2048`  | Database size warning threshold             |
| `DISABLE_SQLITE_AUTO_BACKUP` | `false` | Turn off automatic database backups         |
| `COOLROUTER_MEMORY_MB`       | `512`   | Node.js memory limit for the server process |

## Provider keys from the environment

Instead of adding keys in the dashboard, you can set them here, for example `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`. See `.env.example` for the full list.
