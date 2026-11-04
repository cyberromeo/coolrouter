# API reference

Cool Router speaks the OpenAI API, plus Anthropic, Gemini and Ollama formats, on one base URL:

```
http://localhost:20128/v1
```

Replace `localhost:20128` with your host and port if you changed them.

## Authentication

Send a Cool Router API key (created on the **API Keys** page) as a Bearer token:

```
Authorization: Bearer sk-...
```

Keys are enforced when `REQUIRE_API_KEY=true`, which is recommended whenever the server is reachable from other machines. With the default `REQUIRE_API_KEY=false`, requests without a key are accepted, but a key is still needed for per-key limits and usage tracking.

## Model names

| Form             | Example              | Meaning                                              |
| ---------------- | -------------------- | ---------------------------------------------------- |
| `provider/model` | `openai/gpt-4o-mini` | A specific model on a specific provider              |
| `alias/model`    | `cc/claude-sonnet-4` | Short provider aliases work too (`cc` = Claude Code) |
| `combo-name`     | `my-fallbacks`       | A combo you created; Cool Router picks the model     |

`GET /v1/models` returns every model and combo your key can use.

## Endpoints

| Method | Path                                          | Format                         |
| ------ | --------------------------------------------- | ------------------------------ |
| POST   | `/v1/chat/completions`                        | OpenAI Chat Completions        |
| POST   | `/v1/completions`                             | OpenAI legacy completions      |
| POST   | `/v1/responses`                               | OpenAI Responses               |
| POST   | `/v1/messages`                                | Anthropic Messages             |
| POST   | `/v1/messages/count_tokens`                   | Anthropic token count          |
| POST   | `/v1/embeddings`                              | OpenAI embeddings              |
| POST   | `/v1/images/generations`                      | OpenAI images                  |
| POST   | `/v1/audio/speech`                            | OpenAI text-to-speech          |
| POST   | `/v1/audio/transcriptions`                    | OpenAI transcription           |
| POST   | `/v1/moderations`                             | OpenAI moderation              |
| POST   | `/v1/rerank`                                  | Cohere-style rerank            |
| POST   | `/v1/videos/generations`                      | Video generation               |
| POST   | `/v1/music/generations`                       | Music generation               |
| POST   | `/v1/search`                                  | Web search providers           |
| GET    | `/v1/models`                                  | OpenAI model list              |
| GET    | `/v1beta/models`                              | Gemini model list              |
| POST   | `/v1beta/models/{model}:generateContent`      | Gemini                         |
| POST   | `/v1/api/chat`                                | Ollama chat                    |
| POST   | `/v1/providers/{provider}/chat/completions`   | OpenAI, pinned to one provider |
| POST   | `/v1/providers/{provider}/embeddings`         | OpenAI, pinned to one provider |
| POST   | `/v1/providers/{provider}/images/generations` | OpenAI, pinned to one provider |

Streaming works everywhere the upstream format supports it (`"stream": true`, server-sent events).

## Examples

### Chat

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer $COOL_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Write a haiku about routers."}],
    "stream": true
  }'
```

### Anthropic Messages

```bash
curl http://localhost:20128/v1/messages \
  -H "Authorization: Bearer $COOL_ROUTER_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "cc/claude-sonnet-4", "max_tokens": 256,
       "messages": [{"role": "user", "content": "Hello"}]}'
```

### Embeddings

```bash
curl http://localhost:20128/v1/embeddings \
  -H "Authorization: Bearer $COOL_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/text-embedding-3-small", "input": "The quick brown fox"}'
```

### Transcription

```bash
curl http://localhost:20128/v1/audio/transcriptions \
  -H "Authorization: Bearer $COOL_ROUTER_KEY" \
  -F "file=@meeting.mp3" \
  -F "model=openai/whisper-1"
```

## Request headers

| Header            | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `X-Session-Id`    | Sticky session key so follow-up turns hit the same account |
| `Idempotency-Key` | Deduplicates identical requests sent within a few seconds  |
| `X-Request-Id`    | Alternative deduplication key                              |

## Errors

Errors use the OpenAI shape:

```json
{
  "error": {
    "message": "No credentials for provider: openai",
    "type": "invalid_request_error",
    "code": "bad_request"
  }
}
```

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| 400    | Bad request, unknown model, or no provider connected for it          |
| 401    | Missing or invalid API key                                           |
| 403    | The key isn't allowed to use that model or provider                  |
| 429    | Every account for the model is rate-limited (combos fall back first) |
| 5xx    | Upstream provider error after all fallbacks were tried               |

## OpenAPI

A machine-readable spec lives in [`openapi.yaml`](openapi.yaml).
