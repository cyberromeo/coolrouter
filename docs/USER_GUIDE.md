# User guide

A tour of the dashboard and the everyday jobs: connecting providers, building combos, issuing keys and plugging in your tools.

## Home

Your endpoint URL with copy-paste snippets for cURL, Python and Node.js, four quick stats (providers, models, requests and tokens in the last 24 hours), and a three-step **Get started** checklist that ticks itself off as you go.

## Providers

Every supported provider appears as a card, grouped by how you connect:

- **Account sign-in (OAuth)**: Claude Code, OpenAI Codex, GitHub Copilot, Gemini CLI, Qwen Code, Kiro, Cursor and others. Click the card, then **Connect** and finish the sign-in in the browser window that opens.
- **API key**: OpenAI, Anthropic, Gemini (AI Studio), OpenRouter, DeepSeek, Groq, xAI, Mistral and dozens more. Click the card, **Add connection**, paste the key.
- **Compatible endpoints**: add any OpenAI- or Anthropic-compatible server (Ollama, LM Studio, vLLM, a company proxy) with its base URL.

Tips:

- Add several accounts or keys for the same provider. Cool Router spreads load across them and skips any that hit a rate limit.
- **Test** checks a connection; **Test All** checks every one.
- Turn on **Configured only** to hide providers you haven't set up.
- Open a provider to see its models, sync the model list, or disable a model.

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
| Security | Dashboard password, require login, IP allow/deny lists, sessions                             |
| Routing  | Default routing strategy, combo defaults, model aliases, fallback chains                     |
| Advanced | Upstream HTTP/SOCKS proxy for provider traffic                                               |

## Connect your tools

Anything that accepts an OpenAI-compatible base URL works. Use `http://localhost:20128/v1` as the base URL, a Cool Router key as the API key, and a `provider/model` or combo name as the model.

| Tool                       | Where to set it                                                              |
| -------------------------- | ---------------------------------------------------------------------------- |
| OpenAI SDK (Python / Node) | `base_url` / `baseURL` and `api_key` / `apiKey`                              |
| Cursor                     | Settings → Models → OpenAI API Key → Override OpenAI Base URL                |
| Cline / Roo Code           | API Provider: OpenAI Compatible → Base URL, API Key, Model ID                |
| Continue                   | `config.yaml`: `provider: openai`, `apiBase`, `apiKey`, `model`              |
| Codex CLI                  | `OPENAI_BASE_URL=http://localhost:20128/v1` and `OPENAI_API_KEY`             |
| Claude Code                | `ANTHROPIC_BASE_URL=http://localhost:20128` and `ANTHROPIC_AUTH_TOKEN=<key>` |
| Open WebUI / LibreChat     | Add an OpenAI connection with the base URL and key                           |

## Backups

**Settings → General** can export a full backup (database and settings) and restore one. Provider credentials are encrypted with `STORAGE_ENCRYPTION_KEY`, so keep your `.env` with your backup.
