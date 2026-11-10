import test from "node:test";
import assert from "node:assert/strict";

const {
  ollamaToOpenAIChatRequest,
  openAIToOllamaResponse,
  createOpenAIToOllamaStream,
  transformToOllama,
} = await import("../../open-sse/utils/ollamaTransform.ts");
const { detectFormatFromEndpoint } = await import("../../open-sse/services/provider.ts");

function sseResponse(events, { done = true } = {}) {
  const body =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    (done ? "data: [DONE]\n\n" : "");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function chunk(delta, finishReason = null, extra = {}) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    model: "mock-small",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  };
}

function parseLines(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

// ── Request ──────────────────────────────────────────────────────────────────

test("Ollama -> OpenAI streams by default and honors an explicit stream:false", () => {
  const messages = [{ role: "user", content: "hi" }];
  assert.equal(ollamaToOpenAIChatRequest({ model: "m", messages }).stream, true);
  assert.equal(ollamaToOpenAIChatRequest({ model: "m", messages, stream: true }).stream, true);
  assert.equal(ollamaToOpenAIChatRequest({ model: "m", messages, stream: false }).stream, false);
});

test("Ollama -> OpenAI maps options and drops Ollama-only fields", () => {
  const result = ollamaToOpenAIChatRequest({
    model: "mock/mock-small",
    messages: [{ role: "user", content: "hi" }],
    options: {
      temperature: 0.7,
      top_p: 0.9,
      num_predict: 32,
      stop: ["\n"],
      seed: 7,
      num_ctx: 4096,
    },
    keep_alive: "5m",
    think: false,
    format: "json",
  });

  assert.deepEqual(result, {
    model: "mock/mock-small",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 32,
    stop: ["\n"],
    seed: 7,
    response_format: { type: "json_object" },
  });
});

test("Ollama -> OpenAI keeps explicit OpenAI parameters over options and maps schema formats", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } } };
  const result = ollamaToOpenAIChatRequest({
    model: "m",
    messages: [],
    temperature: 0.1,
    options: { temperature: 0.9 },
    format: schema,
  });

  assert.equal(result.temperature, 0.1);
  assert.deepEqual(result.response_format, {
    type: "json_schema",
    json_schema: { name: "response", schema },
  });
});

test("Ollama -> OpenAI turns message images into image_url parts", () => {
  const result = ollamaToOpenAIChatRequest({
    model: "m",
    messages: [
      { role: "user", content: "what is this?", images: ["QUJD", "data:image/jpeg;base64,REVG"] },
      { role: "assistant", content: "a cat" },
    ],
  });

  assert.deepEqual(result.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,REVG" } },
      ],
    },
    { role: "assistant", content: "a cat" },
  ]);
});

test("the Ollama and Gemini routes are always read as OpenAI-format bodies", () => {
  // A converted body with max_tokens and nothing OpenAI-specific looks like Claude to the
  // body heuristics; the endpoint has to win.
  const body = { model: "m", max_tokens: 32, messages: [{ role: "user", content: "hi" }] };
  assert.equal(detectFormatFromEndpoint(body, "/unknown/path"), "claude");
  assert.equal(detectFormatFromEndpoint(body, "/v1/api/chat"), "openai");
  assert.equal(detectFormatFromEndpoint(body, "/api/v1/api/chat"), "openai");
  assert.equal(
    detectFormatFromEndpoint(body, "/v1beta/models/mock/mock-small:generateContent"),
    "openai"
  );
  assert.equal(
    detectFormatFromEndpoint(body, "/api/v1beta/models/gemini-pro:streamGenerateContent"),
    "openai"
  );
  // Existing endpoint rules are untouched.
  assert.equal(detectFormatFromEndpoint(body, "/v1/messages"), "claude");
  assert.equal(detectFormatFromEndpoint(body, "/v1/chat/completions"), "openai");
  assert.equal(detectFormatFromEndpoint({ input: "hi" }, "/v1/responses"), "openai-responses");
});

// ── Response ─────────────────────────────────────────────────────────────────

test("OpenAI chat.completion -> single Ollama response object", () => {
  const result = openAIToOllamaResponse(
    {
      choices: [{ message: { role: "assistant", content: "MOCK:hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    },
    "mock/mock-small"
  );

  assert.equal(typeof result.created_at, "string");
  assert.equal(Number.isNaN(Date.parse(result.created_at)), false);
  delete result.created_at;
  assert.deepEqual(result, {
    model: "mock/mock-small",
    message: { role: "assistant", content: "MOCK:hi" },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 7,
    eval_count: 5,
  });
});

test("OpenAI chat.completion -> Ollama maps tool calls, reasoning and truncation", () => {
  const result = openAIToOllamaResponse(
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "hmm",
            tool_calls: [
              { id: "call_1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
            ],
          },
          finish_reason: "length",
        },
      ],
    },
    "m"
  );

  assert.deepEqual(result.message, {
    role: "assistant",
    content: "",
    thinking: "hmm",
    tool_calls: [{ function: { name: "get_weather", arguments: { city: "Paris" } } }],
  });
  assert.equal(result.done_reason, "length");
  assert.equal("eval_count" in result, false);
});

test("transformToOllama streams NDJSON content lines and exactly one done line", async () => {
  const response = await transformToOllama(
    sseResponse([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Hel" }),
      chunk({ content: "lo" }),
      chunk({}, "stop", { usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } }),
    ]),
    "mock/mock-small"
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const lines = parseLines(await response.text());

  assert.deepEqual(
    lines.map((line) => [line.message.content, line.done]),
    [
      ["Hel", false],
      ["lo", false],
      ["", true],
    ]
  );
  for (const line of lines) {
    assert.equal(line.model, "mock/mock-small");
    assert.equal(line.message.role, "assistant");
    assert.equal(typeof line.created_at, "string");
  }
  const last = lines.at(-1);
  assert.equal(last.done_reason, "stop");
  assert.equal(last.prompt_eval_count, 7);
  assert.equal(last.eval_count, 5);
});

test("transformToOllama ends with one done line even without [DONE]", async () => {
  const response = await transformToOllama(
    sseResponse([chunk({ content: "partial" })], { done: false }),
    "m"
  );

  const lines = parseLines(await response.text());
  assert.equal(lines.filter((line) => line.done === true).length, 1);
  assert.equal(lines.at(-1).done, true);
});

test("createOpenAIToOllamaStream emits streamed tool calls before the done line", async () => {
  const source = sseResponse([
    chunk({
      tool_calls: [{ index: 0, id: "call_a", function: { name: "get_weather", arguments: "" } }],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":"Paris"}' } }] }),
    // Same index, new id: a second call that must not be merged into the first (T37).
    chunk({
      tool_calls: [{ index: 0, id: "call_b", function: { name: "get_time", arguments: "{}" } }],
    }),
    chunk({}, "tool_calls"),
  ]);

  const text = await new Response(source.body.pipeThrough(createOpenAIToOllamaStream("m"))).text();
  const lines = parseLines(text);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].done, false);
  assert.deepEqual(lines[0].message.tool_calls, [
    { function: { name: "get_weather", arguments: { city: "Paris" } } },
    { function: { name: "get_time", arguments: {} } },
  ]);
  assert.equal(lines[1].done, true);
  assert.equal("tool_calls" in lines[1].message, false);
});

test("transformToOllama returns one JSON object for a non-streaming completion", async () => {
  const response = await transformToOllama(
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "MOCK:json" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 5 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ),
    "mock/mock-small"
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.message.content, "MOCK:json");
  assert.equal(body.done, true);
  assert.equal(body.eval_count, 5);
});

test("transformToOllama reports errors as { error } with the original status", async () => {
  const response = await transformToOllama(
    new Response(
      JSON.stringify({
        error: {
          message: "Invalid API key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    ),
    "m"
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid API key" });
});
