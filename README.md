<p align="center">
  <img src="public/favicon.svg" width="88" height="88" alt="Cool Router logo" />
</p>

<h1 align="center">Cool Router</h1>

<p align="center"><b>One endpoint for every AI model.</b><br/>
A free, self-hosted LLM gateway with a clean, minimal dashboard.</p>

<p align="center">
  <a href="https://github.com/cyberromeo/coolrouter/releases/latest">Download</a> ·
  <a href="docs/INSTALL.md">Install</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="docs/API_REFERENCE.md">API</a> ·
  <a href="docs/CONFIGURATION.md">Configuration</a>
</p>

---

Cool Router sits between your apps and AI providers. Connect OpenAI, Anthropic, Gemini, OpenRouter and 60+ other providers once, then point any OpenAI-compatible app, SDK or coding tool at a single URL:

```
http://localhost:20128/v1
```

If a provider is rate-limited or down, a **combo** falls back to the next model automatically.

## Features

- **One endpoint**: OpenAI Chat Completions, Responses, Anthropic Messages, embeddings, images, audio and rerank.
- **60+ providers**: API keys or account sign-in, including several free tiers.
- **Combos**: chain models with fallback, round-robin, weighted, cheapest-first and more.
- **API keys**: issue keys for each app, teammate or tool, with optional model and provider limits.
- **Playground**: send test requests to any model from the browser.
- **Usage and logs**: tokens, estimated cost and every request in one place.
- **Private by default**: runs on your machine, stores everything in local SQLite, encrypts credentials, works offline.

## Install

| Platform | Get it                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| macOS    | `.dmg` from [Releases](https://github.com/cyberromeo/coolrouter/releases/latest) (Apple Silicon and Intel)         |
| Windows  | `.exe` installer from [Releases](https://github.com/cyberromeo/coolrouter/releases/latest)                         |
| Linux    | `.AppImage` or `.deb` from [Releases](https://github.com/cyberromeo/coolrouter/releases/latest)                    |
| Docker   | `docker run -d -p 20128:20128 -v cool-router-data:/app/data ghcr.io/cyberromeo/cool-router:latest`                 |
| Source   | `git clone https://github.com/cyberromeo/coolrouter && cd coolrouter && npm install && npm run build && npm start` |

Full instructions, including checksum and signature verification: [docs/INSTALL.md](docs/INSTALL.md).

## Updates

Cool Router checks [GitHub Releases](https://github.com/cyberromeo/coolrouter/releases) for new versions (on launch and every 6 hours) and tells you when one is out. **Settings → General → Updates** shows your version and has a **Check for updates** button.

| Install                 | How you update                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Windows, Linux AppImage | Downloads in the background, then **Restart to update**                                              |
| macOS, Linux `.deb`     | Notification and banner link to the new installer (unsigned builds can't self-install)               |
| Docker                  | `docker pull ghcr.io/cyberromeo/cool-router:latest && docker compose up -d` (or re-run `docker run`) |
| Source                  | `git pull && npm install && npm run build`, then restart                                             |

Set `COOLROUTER_DISABLE_UPDATE_CHECK=1` to turn the check off.

## Quick start

1. Open **http://localhost:20128**. On first launch the setup wizard asks you to **create a password** (desktop app, Docker and source all work the same way; there is no built-in default). If you set `INITIAL_PASSWORD` for a headless deploy, sign in with that instead and change it in **Settings → Security**.
2. **Providers** → pick a provider → add your API key or sign in.
3. **API Keys** → **Create API Key** and copy it.
4. Call the gateway:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer $COOL_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Or with the OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:20128/v1", api_key="<your Cool Router key>")
reply = client.chat.completions.create(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)
```

Models are named `provider/model` (for example `openai/gpt-4o-mini`), or use the name of a combo you created. `GET /v1/models` lists everything available to your key.

## Dashboard

| Page       | What it's for                                          |
| ---------- | ------------------------------------------------------ |
| Home       | Your endpoint URL, copy-paste snippets, quick stats    |
| Providers  | Connect API keys or accounts and test them             |
| Combos     | Fallback chains and load balancing across models       |
| API Keys   | Create, scope and revoke keys for your apps            |
| Playground | Send test requests to any model                        |
| Usage      | Tokens, cost and trends                                |
| Logs       | Every request with status, latency and tokens          |
| Settings   | Appearance, password, routing defaults, upstream proxy |

## Documentation

- [Install](docs/INSTALL.md): desktop apps, Docker, source, verifying downloads
- [User guide](docs/USER_GUIDE.md): providers, combos, API keys, connecting your tools
- [API reference](docs/API_REFERENCE.md): every endpoint the gateway serves
- [Configuration](docs/CONFIGURATION.md): environment variables
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Releasing](docs/RELEASING.md): building and signing installers

## Development

```bash
npm install
npm run dev          # http://localhost:20128
npm run lint
npm run typecheck:core
npm run test:unit
npm run build
```

Requires Node.js 18, 20 or 22 (`package.json` engines: `>=18 <24`; Node 22 LTS recommended, Node 24 is not supported by the SQLite driver). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
