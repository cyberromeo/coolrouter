# User guide

A tour of the dashboard. The main menu is three steps: **Providers** (where your models come from), **Model map** (which model answers what) and **Connect apps** (Claude Code, Claude Desktop, Codex or anything else). The power tools (Combos, API keys, Playground, Usage and Logs) are under **Advanced** in the sidebar.

## Home

The three steps with their status: how many providers are connected, which model answers Opus, Sonnet and Haiku, and which apps are connected. The step to do next is highlighted. Below it: your endpoint URL and the last 24 hours of requests and tokens. If Cool Router's port changed since you connected an app, a banner offers to update it.

## Providers

**Your providers** lists what you have connected, with **Test**, **Refresh models**, **Details** and **Remove**. Under it, **Add a provider** shows every supported provider, grouped by how you pay:

- **Pay per use**: paste an API key (OpenAI, Anthropic, Gemini, DeepSeek, Groq, xAI, Mistral, OpenRouter and many more). The key is checked before it is saved; **Get a key** opens the provider's key page.
- **Subscriptions**: sign in with a plan you already have, such as Claude, ChatGPT/Codex, GitHub Copilot, Cursor or Kiro.
- **Free**: providers with a free tier or free sign-in.
- **On this computer**: Ollama, LM Studio and llama.cpp. Cool Router looks for them on their usual port and connects every model they serve; if one isn't running, it shows the command to start it.
- **Custom URL**: any other OpenAI- or Anthropic-compatible service: a name, its base URL and, if needed, a key.

After you connect a provider, its models are fetched automatically, and if your model map is still empty it is filled in for you. **Detailed view** (top right) shows the previous all-cards layout with bulk tests and imports; a provider's **Details** page has its accounts, models and advanced options.

## Model map

Claude Code and Claude Desktop only ask for Claude models: Opus, Sonnet and Haiku. The model map decides which of **your** models answer each of those names. Each of the three routes is a list in fallback order: the first model answers, and if it fails (an outage, a rate limit, a request too large for it) the next one takes over.

- **Map** view: a mind map with your apps on the left, Cool Router in the middle, and the three routes and their models on the right. Drag a model along its row to reorder it, or onto another row to move it. **Your models** opens a drawer with every connected model: drag one onto a route, or press **O**, **S** or **H** to add it to Opus, Sonnet or Haiku.
- **List** view: the same routes as three lists with move and remove buttons, for keyboard use.
- **Arrange for me** spreads your models over the three routes: the most capable (by price) on Opus, the cheapest on Haiku. It skips models without tool use or with less than 100k context, which Claude Code can't work with.
- Changes save by themselves.

What the routes answer:

| An app asks for                                                  | Answered by      |
| ---------------------------------------------------------------- | ---------------- |
| `claude-opus-…`, `claude-fable-…` or `opus`                      | the Opus route   |
| `claude-sonnet-…`, any other `claude-…` name, `sonnet` or `auto` | the Sonnet route |
| `claude-haiku-…` or `haiku`                                      | the Haiku route  |

A route with no models uses its neighbour's. Names with a provider prefix (`cc/claude-…`, `anthropic/claude-…`) are not affected and still go straight to that provider. The routes are three ordinary combos named `opus`, `sonnet` and `haiku`.

These rules switch on only once you save a change on the map or connect an app, so upgrading never changes how existing `claude-…` requests are routed.

## Combos

A combo is a named list of models that behaves like a single model. Use its name anywhere you'd put a model:

```json
{ "model": "my-fallbacks", "messages": [ ... ] }
```

Create one in **Combos → New combo**: give it a name, add models in order, pick a strategy.

| Strategy           | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| Priority           | Tries model 1, then 2, and so on. The classic fallback chain. |
| Weighted           | Splits traffic by percentage, with fallback                   |
| Round-robin        | Each request goes to the next model in turn                   |
| Random             | Picks at random, then falls back to the rest                  |
| Strict random      | Uses each model once before reshuffling                       |
| Least used         | Picks the model with the fewest requests so far               |
| Cost optimized     | Cheapest model first, based on pricing data                   |
| Fill first         | Uses one model until it's exhausted, then moves on            |
| Power of two (P2C) | Compares two random candidates and picks the healthier one    |
| Last known good    | Sticks with the last provider that succeeded                  |
| Auto               | Self-tuning pool that favours fast, healthy models            |
| Context relay      | Keeps long sessions coherent when accounts rotate             |
| Context optimized  | Prefers models with the largest context window                |

A sensible starter combo: your favourite paid model first, a cheaper model second, a free-tier model last. Drag cards to reorder combos; defaults for new combos live in **Settings → Routing**.

## API keys

Create a key for each app, teammate or tool so you can see usage per key and revoke one without touching the others.

1. **API Keys → Create API Key**, give it a name.
2. Copy the key right away. It's only shown once.
3. Optional: limit the key to certain models or provider connections.

To make keys mandatory for every request, set `REQUIRE_API_KEY=true` (see [Configuration](CONFIGURATION.md)).

## Playground

Pick an endpoint (chat, responses, images, embeddings, speech, transcription, video, music, rerank), a provider, a model and an account, edit the JSON request and **Send**. The raw response appears next to it. Handy for checking a new provider or combo before wiring it into an app.

## Usage

Total tokens, input and output split, estimated cost, top models and providers, an activity heatmap and daily trends. Switch ranges from 1 day to all time. Costs are estimates from built-in pricing data.

## Logs

Every request with time, status, model, provider, account, API key, combo, tokens and duration. Filter by provider, model, account or key, search, or show only errors. **Export** downloads the last 1 to 24 hours as JSON. Click a row for the full request and response.

## Settings

| Tab      | What's there                                                                                 |
| -------- | -------------------------------------------------------------------------------------------- |
| General  | Light/dark/system theme, accent colour, sidebar items, language, storage, backup and restore |
| Security | Dashboard password, require login, blocked providers, sessions                               |
| Routing  | Default routing strategy, combo defaults, model aliases, fallback chains                     |
| Advanced | Upstream HTTP/SOCKS proxy for provider traffic                                               |

## Connect your apps

**Connect apps** has a card for each app. Every app gets its own Cool Router key, named after the app and listed under Advanced → API keys. Each card shows whether the app is installed and connected, and turns **Live** once the app's first message reaches Cool Router. **Show me how** has the steps and a manual alternative with values to copy.

### Claude Code

**Connect** adds these to the `env` block of `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`; `CLAUDE_CONFIG_DIR` is honoured). Nothing else in the file changes, and a backup is kept in Cool Router's data folder.

| Variable                                                | Value                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL`                                    | `http://127.0.0.1:20128` (your port)                              |
| `ANTHROPIC_AUTH_TOKEN`                                  | the key made for Claude Code                                      |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_` / `_HAIKU_` | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`        |
| `ANTHROPIC_DEFAULT_*_MODEL_NAME`                        | for example "Opus → GPT 5 (Cool Router)", shown in `/model`       |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW`                       | the smallest context window of your first-choice models, if known |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`                | `1` when a route uses a model not served by Anthropic             |

It also removes `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` from that block while connected, so they don't compete with the routes. **Disconnect** puts back exactly the values that were there before. Restart Claude Code afterwards and run `/status`: it should show _Anthropic base URL: http://127.0.0.1:20128_.

### Claude Desktop

Claude Desktop keeps its gateway settings in a folder it manages itself, so Cool Router gives you a setup file instead of editing them:

1. **Download setup file** (`CoolRouter-ClaudeDesktop.json`).
2. In Claude Desktop: **Help → Troubleshooting → Enable Developer Mode** (on Windows, open the ☰ menu first).
3. **Developer → Configure Third-Party Inference…**
4. **Import configuration…**, choose the file, then **Apply Changes** and **Relaunch now**.
5. Pick Opus, Sonnet or Haiku as usual.

Or set **Inference provider** to **Gateway** and type the base URL and key shown on the card. Delete the setup file after importing: it contains Claude Desktop's key.

### Codex

Choose the route Codex should use (Sonnet by default) and click **Connect**. Cool Router edits `~/.codex/config.toml` (`CODEX_HOME` is honoured): it sets `model`, `model_provider = "coolrouter"` and `model_context_window`, and adds a `[model_providers.coolrouter]` table with `base_url = "http://127.0.0.1:20128/v1"`, `wire_api = "responses"` and the key. Comments and everything else in the file stay. If the file uses a layout Cool Router can't edit safely, nothing is changed and the card shows the block to paste instead.

### Any other app

**Show address and key** gives the base URL (`…/v1`), a key and the model `auto` (the Sonnet route), with OpenAI SDK, Anthropic SDK and curl examples. You can also ask for `opus`, `sonnet` or `haiku`, a combo name or a `provider/model` id.

| Tool                       | Where to set it                                                 |
| -------------------------- | --------------------------------------------------------------- |
| OpenAI SDK (Python / Node) | `base_url` / `baseURL` and `api_key` / `apiKey`                 |
| Cursor                     | Settings → Models → OpenAI API Key → Override OpenAI Base URL   |
| Cline / Roo Code           | API Provider: OpenAI Compatible → Base URL, API Key, Model ID   |
| Continue                   | `config.yaml`: `provider: openai`, `apiBase`, `apiKey`, `model` |
| Open WebUI / LibreChat     | Add an OpenAI connection with the base URL and key              |

## Backups

**Settings → General** can export a full backup (database and settings) and restore one. Provider credentials are encrypted with `STORAGE_ENCRYPTION_KEY`, so keep your `.env` with your backup.
