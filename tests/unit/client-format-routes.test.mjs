// Route-level contracts for the non-OpenAI client formats: each route must answer in the
// wire format its clients speak (Gemini, Anthropic, Ollama, legacy completions), including
// errors, while the request runs through the shared OpenAI-format chat pipeline.
import test from "node:test";
import assert from "node:assert/strict";

import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.mjs";

const harness = await createChatPipelineHarness("client-format-routes");
const { BaseExecutor, resetStorage, seedConnection, seedApiKey, toPlainHeaders } = harness;

const geminiRoute = await import("../../src/app/api/v1beta/models/[...path]/route.ts");
const messagesRoute = await import("../../src/app/api/v1/messages/route.ts");
const ollamaRoute = await import("../../src/app/api/v1/api/chat/route.ts");
const completionsRoute = await import("../../src/app/api/v1/completions/route.ts");

const USAGE = { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 };

function openAIJson(text) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-upstream",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o-mini",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: USAGE,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function openAIStream(pieces) {
  const event = (delta, finishReason = null, extra = {}) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-upstream",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4o-mini",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...extra,
    })}\n\n`;
  const body =
    event({ role: "assistant", content: "" }) +
    pieces.map((piece) => event({ content: piece })).join("") +
    event({}, "stop", { usage: USAGE }) +
    "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

// Fake OpenAI upstream: answers in whatever mode the pipeline asked for and records the calls.
function mockUpstream() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), headers: toPlainHeaders(init.headers), body });
    return body?.stream === true ? openAIStream(["Hel", "lo"]) : openAIJson("Hello");
  };
  return calls;
}

function post(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function gemini(pathAndQuery, body, headers = {}) {
  const url = `http://localhost/v1beta/models/${pathAndQuery}`;
  const path = pathAndQuery.split("?")[0].split("/");
  return geminiRoute.POST(post(url, body, headers), { params: Promise.resolve({ path }) });
}

function parseSseEvents(text) {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: {"))
    .map((block) => JSON.parse(block.slice("data: ".length)));
}

const GEMINI_BODY = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  process.env.REQUIRE_API_KEY = "false";
  await resetStorage();
});

test.afterEach(async () => {
  process.env.REQUIRE_API_KEY = "false";
  await resetStorage();
});

test.after(async () => {
  await harness.cleanup();
});

// ── Gemini: /v1beta/models/{model}:generateContent ───────────────────────────

test("Gemini generateContent returns one GenerateContentResponse object", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const response = await gemini("openai/gpt-4o-mini:generateContent", {
    system_instruction: { parts: [{ text: "be brief" }] },
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    generationConfig: { maxOutputTokens: 50, stopSequences: ["END"] },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.deepEqual(body.candidates, [
    { content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP", index: 0 },
  ]);
  assert.equal(body.usageMetadata.candidatesTokenCount, 5);
  assert.equal(
    body.usageMetadata.totalTokenCount,
    body.usageMetadata.promptTokenCount + body.usageMetadata.candidatesTokenCount
  );
  assert.equal(typeof body.modelVersion, "string");

  // Upstream saw a plain non-streaming OpenAI chat request.
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/chat\/completions$/);
  assert.deepEqual(
    calls[0].body.messages.map((message) => [message.role, message.content]),
    [
      ["system", "be brief"],
      ["user", "hi"],
    ]
  );
  assert.equal(calls[0].body.max_tokens, 50);
  assert.deepEqual(calls[0].body.stop, ["END"]);
  assert.notEqual(calls[0].body.stream, true);
});

test("Gemini streamGenerateContent?alt=sse streams GenerateContentResponse events", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const response = await gemini("openai/gpt-4o-mini:streamGenerateContent?alt=sse", GEMINI_BODY);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.equal(text.includes("chat.completion.chunk"), false);
  assert.equal(text.includes("[DONE]"), false);

  const events = parseSseEvents(text);
  assert.deepEqual(
    events.map((event) => event.candidates[0].content.parts[0].text),
    ["Hel", "lo", ""]
  );
  const last = events.at(-1);
  assert.equal(last.candidates[0].finishReason, "STOP");
  assert.equal(last.usageMetadata.candidatesTokenCount, 5);
  assert.equal(calls[0].body.stream, true);
});

test("Gemini streamGenerateContent without alt=sse returns a JSON array of chunks", async () => {
  await seedConnection("openai");
  mockUpstream();

  const response = await gemini("openai/gpt-4o-mini:streamGenerateContent", GEMINI_BODY);

  assert.match(response.headers.get("content-type"), /application\/json/);
  const chunks = await response.json();
  assert.equal(Array.isArray(chunks), true);
  assert.equal(chunks.map((item) => item.candidates[0].content.parts[0].text).join(""), "Hello");
  assert.equal(chunks.at(-1).candidates[0].finishReason, "STOP");
});

test("Gemini accepts the API key as x-goog-api-key or ?key= and rejects unknown keys", async () => {
  await seedConnection("openai");
  const apiKey = await seedApiKey();
  const calls = mockUpstream();

  const viaHeader = await gemini("openai/gpt-4o-mini:generateContent", GEMINI_BODY, {
    "x-goog-api-key": apiKey.key,
  });
  assert.equal(viaHeader.status, 200);

  const viaQuery = await gemini(
    `openai/gpt-4o-mini:generateContent?key=${encodeURIComponent(apiKey.key)}`,
    GEMINI_BODY
  );
  assert.equal(viaQuery.status, 200);
  assert.equal(calls.length, 2);

  for (const rejected of [
    await gemini("openai/gpt-4o-mini:generateContent", GEMINI_BODY, {
      "x-goog-api-key": "sk-nope",
    }),
    await gemini("openai/gpt-4o-mini:generateContent?key=sk-nope", GEMINI_BODY),
  ]) {
    assert.equal(rejected.status, 401);
    assert.deepEqual(await rejected.json(), {
      error: { code: 401, message: "Invalid API key", status: "UNAUTHENTICATED" },
    });
  }
  assert.equal(calls.length, 2, "rejected requests must not reach the provider");
});

test("Gemini honors REQUIRE_API_KEY with keys sent the Gemini way", async () => {
  await seedConnection("openai");
  const apiKey = await seedApiKey();
  mockUpstream();
  process.env.REQUIRE_API_KEY = "true";

  const missing = await gemini("openai/gpt-4o-mini:generateContent", GEMINI_BODY);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.status, "UNAUTHENTICATED");

  const valid = await gemini("openai/gpt-4o-mini:generateContent", GEMINI_BODY, {
    "x-goog-api-key": apiKey.key,
  });
  assert.equal(valid.status, 200);
});

test("Gemini errors use Google's error shape", async () => {
  mockUpstream();

  const invalidJson = await gemini("openai/gpt-4o-mini:generateContent", "{not json");
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error.status, "INVALID_ARGUMENT");

  const invalidBody = await gemini("openai/gpt-4o-mini:generateContent", { foo: 1 });
  assert.equal(invalidBody.status, 400);
  const invalidBodyPayload = await invalidBody.json();
  assert.equal(invalidBodyPayload.error.code, 400);
  assert.equal(invalidBodyPayload.error.status, "INVALID_ARGUMENT");
  assert.match(invalidBodyPayload.error.message, /contents or systemInstruction is required/);

  const unknownMethod = await gemini("openai/gpt-4o-mini:embedContent", GEMINI_BODY);
  assert.equal(unknownMethod.status, 404);
  assert.equal((await unknownMethod.json()).error.status, "NOT_FOUND");

  // No connection for the provider: the pipeline's 400 comes back in Google's shape.
  const noCredentials = await gemini("openai/gpt-4o-mini:generateContent", GEMINI_BODY);
  assert.equal(noCredentials.status, 400);
  const noCredentialsPayload = await noCredentials.json();
  assert.deepEqual(Object.keys(noCredentialsPayload), ["error"]);
  assert.equal(noCredentialsPayload.error.code, 400);
  assert.equal(noCredentialsPayload.error.status, "INVALID_ARGUMENT");
  assert.equal(typeof noCredentialsPayload.error.message, "string");
});

test("Gemini upstream failures keep their status in Google's shape", async () => {
  await seedConnection("openai");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "upstream exploded" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

  const response = await gemini("openai/gpt-4o-mini:streamGenerateContent?alt=sse", GEMINI_BODY);

  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.error.code, 500);
  assert.equal(body.error.status, "INTERNAL");
  assert.match(body.error.message, /upstream exploded/);
});

test("Gemini countTokens returns a token estimate without calling a provider", async () => {
  const calls = mockUpstream();

  const response = await gemini("openai/gpt-4o-mini:countTokens", {
    contents: [{ role: "user", parts: [{ text: "abcdefgh" }] }],
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { totalTokens: 2 });
  assert.equal(calls.length, 0);
});

// ── Anthropic: /v1/messages ──────────────────────────────────────────────────

const CLAUDE_BODY = {
  model: "openai/gpt-4o-mini",
  max_tokens: 64,
  messages: [{ role: "user", content: "hi" }],
};

function messages(body, headers = {}) {
  return messagesRoute.POST(
    post("http://localhost/v1/messages", body, { "anthropic-version": "2023-06-01", ...headers })
  );
}

test("Anthropic messages default to a JSON message when stream is omitted", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  // curl-style request: wildcard Accept, no `stream` field.
  const response = await messages(CLAUDE_BODY, { Accept: "*/*" });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");
  assert.deepEqual(body.content, [{ type: "text", text: "Hello" }]);
  assert.equal(body.stop_reason, "end_turn");
  assert.notEqual(calls[0].body.stream, true);
});

test("Anthropic messages stream when asked to", async () => {
  await seedConnection("openai");
  mockUpstream();

  const response = await messages({ ...CLAUDE_BODY, stream: true });

  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: message_start/);
  assert.match(text, /"text_delta"/);
});

test("Anthropic errors use the Anthropic error envelope", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const badKey = await messages(CLAUDE_BODY, { Authorization: "Bearer sk-nope" });
  assert.equal(badKey.status, 401);
  assert.deepEqual(await badKey.json(), {
    type: "error",
    error: { type: "authentication_error", message: "Invalid API key" },
  });

  const missingModel = await messages({ max_tokens: 8, messages: CLAUDE_BODY.messages });
  assert.equal(missingModel.status, 400);
  assert.deepEqual(await missingModel.json(), {
    type: "error",
    error: { type: "invalid_request_error", message: "Missing model" },
  });

  assert.equal(calls.length, 0);
});

test("Anthropic upstream failures are reported in the Anthropic envelope", async () => {
  await seedConnection("openai");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "upstream exploded" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

  const response = await messages(CLAUDE_BODY);

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "api_error");
  assert.match(body.error.message, /upstream exploded/);
});

test("Anthropic x-api-key is honored when it is a Cool Router key", async () => {
  await seedConnection("openai");
  const apiKey = await seedApiKey();
  mockUpstream();
  process.env.REQUIRE_API_KEY = "true";

  const valid = await messages(CLAUDE_BODY, { "x-api-key": apiKey.key });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).type, "message");

  // Not a Cool Router key: treated as no key, which strict mode rejects.
  const placeholder = await messages(CLAUDE_BODY, { "x-api-key": "sk-placeholder" });
  assert.equal(placeholder.status, 401);
  assert.deepEqual(await placeholder.json(), {
    type: "error",
    error: { type: "authentication_error", message: "Missing API key" },
  });
});

test("Anthropic x-api-key placeholders keep working when keys are not required", async () => {
  await seedConnection("openai");
  mockUpstream();

  const response = await messages(CLAUDE_BODY, { "x-api-key": "sk-placeholder" });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).type, "message");
});

// ── Ollama: /v1/api/chat ─────────────────────────────────────────────────────

function ollama(body, headers = {}) {
  return ollamaRoute.POST(post("http://localhost/v1/api/chat", body, headers));
}

const OLLAMA_BODY = { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hi" }] };

test("Ollama chat streams NDJSON by default and ends with a single done line", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const response = await ollama({ ...OLLAMA_BODY, options: { num_predict: 32 }, keep_alive: "5m" });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const lines = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.deepEqual(
    lines.map((line) => [line.message.content, line.done]),
    [
      ["Hel", false],
      ["lo", false],
      ["", true],
    ]
  );
  assert.equal(lines[0].model, "openai/gpt-4o-mini");
  assert.equal(lines.at(-1).done_reason, "stop");
  assert.equal(lines.at(-1).eval_count, 5);

  // The upstream request is an OpenAI one: streaming on, Ollama-only fields mapped or gone.
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.max_tokens, 32);
  assert.equal("options" in calls[0].body, false);
  assert.equal("keep_alive" in calls[0].body, false);
});

test("Ollama chat returns one JSON object for stream:false", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const response = await ollama({ ...OLLAMA_BODY, stream: false });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.model, "openai/gpt-4o-mini");
  assert.deepEqual(body.message, { role: "assistant", content: "Hello" });
  assert.equal(body.done, true);
  assert.equal(body.done_reason, "stop");
  assert.equal(body.eval_count, 5);
  assert.notEqual(calls[0].body.stream, true);
});

test("Ollama chat reports errors as { error } with the HTTP status", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const badKey = await ollama(OLLAMA_BODY, { Authorization: "Bearer sk-nope" });
  assert.equal(badKey.status, 401);
  assert.deepEqual(await badKey.json(), { error: "Invalid API key" });

  const invalidJson = await ollama("{not json");
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { error: "Invalid JSON body" });

  assert.equal(calls.length, 0);
});

// ── Legacy completions: /v1/completions ──────────────────────────────────────

function completions(body, headers = {}) {
  return completionsRoute.POST(post("http://localhost/v1/completions", body, headers));
}

test("Legacy completions answer a prompt with a text_completion object", async () => {
  await seedConnection("openai");
  const calls = mockUpstream();

  const response = await completions({
    model: "openai/gpt-4o-mini",
    prompt: "say hi",
    max_tokens: 16,
    logprobs: 2,
    echo: false,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, "text_completion");
  assert.deepEqual(body.choices, [
    { text: "Hello", index: 0, logprobs: null, finish_reason: "stop" },
  ]);
  assert.equal(body.usage.completion_tokens, 5);

  assert.deepEqual(
    calls[0].body.messages.map((message) => [message.role, message.content]),
    [["user", "say hi"]]
  );
  assert.equal(calls[0].body.max_tokens, 16);
  assert.equal("prompt" in calls[0].body, false);
  assert.equal("logprobs" in calls[0].body, false);
  assert.equal("echo" in calls[0].body, false);
});

test("Legacy completions stream text_completion chunks", async () => {
  await seedConnection("openai");
  mockUpstream();

  const response = await completions({
    model: "openai/gpt-4o-mini",
    prompt: "say hi",
    stream: true,
  });

  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.equal(text.endsWith("data: [DONE]\n\n"), true);
  const events = parseSseEvents(text);
  assert.equal(
    events.every((event) => event.object === "text_completion"),
    true
  );
  assert.equal(events.map((event) => event.choices[0].text).join(""), "Hello");
  assert.equal(events.at(-1).choices[0].finish_reason, "stop");
});

test("Chat-shaped requests to /v1/completions keep the chat completion shape", async () => {
  await seedConnection("openai");
  mockUpstream();

  const response = await completions({
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].message.content, "Hello");
});
