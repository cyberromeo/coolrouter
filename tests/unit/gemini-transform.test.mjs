import test from "node:test";
import assert from "node:assert/strict";

const {
  parseGeminiModelPath,
  extractGeminiApiKey,
  geminiToOpenAIChatRequest,
  estimateGeminiTokens,
  toGeminiFinishReason,
  toGeminiUsageMetadata,
  openAIToGeminiResponse,
  buildGeminiErrorBody,
  createOpenAIToGeminiStream,
  transformToGemini,
} = await import("../../open-sse/utils/geminiTransform.ts");

const encoder = new TextEncoder();

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

function parseSseEvents(text) {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)));
}

// ── Request ──────────────────────────────────────────────────────────────────

test("parseGeminiModelPath splits provider/model segments from the action", () => {
  assert.deepEqual(parseGeminiModelPath(["mock", "mock-small:generateContent"]), {
    model: "mock/mock-small",
    action: "generateContent",
  });
  assert.deepEqual(parseGeminiModelPath(["gemini-2.5-flash:streamGenerateContent"]), {
    model: "gemini-2.5-flash",
    action: "streamGenerateContent",
  });
});

test("parseGeminiModelPath keeps slashes and colons that belong to the model id", () => {
  assert.deepEqual(parseGeminiModelPath(["openrouter", "meta", "llama-3:free:generateContent"]), {
    model: "openrouter/meta/llama-3:free",
    action: "generateContent",
  });
  assert.deepEqual(parseGeminiModelPath(["mock%2Fmock-small:countTokens"]), {
    model: "mock/mock-small",
    action: "countTokens",
  });
  // A client that prepends the list name ("models/…") to the /models/ URL.
  assert.deepEqual(parseGeminiModelPath(["models", "cc", "claude-opus:generateContent"]), {
    model: "cc/claude-opus",
    action: "generateContent",
  });
  assert.deepEqual(parseGeminiModelPath(["mock", "mock-small"]), {
    model: "mock/mock-small",
    action: "",
  });
});

test("extractGeminiApiKey reads x-goog-api-key first, then the key query parameter", () => {
  const url = "http://localhost/v1beta/models/m:generateContent";
  assert.equal(
    extractGeminiApiKey(new Request(url, { headers: { "x-goog-api-key": "sk-header" } })),
    "sk-header"
  );
  assert.equal(extractGeminiApiKey(new Request(`${url}?key=sk-query&alt=sse`)), "sk-query");
  assert.equal(
    extractGeminiApiKey(
      new Request(`${url}?key=sk-query`, { headers: { "x-goog-api-key": "sk-header" } })
    ),
    "sk-header"
  );
  assert.equal(extractGeminiApiKey(new Request(url)), null);
});

test("Gemini -> OpenAI maps system instruction, roles and generation config", () => {
  const result = geminiToOpenAIChatRequest(
    {
      systemInstruction: { parts: [{ text: "Be brief." }, { text: "Be kind." }] },
      contents: [
        { role: "user", parts: [{ text: "Hi" }] },
        { role: "model", parts: [{ text: "Hello!" }] },
        { parts: [{ text: "How are you?" }] },
      ],
      generationConfig: {
        maxOutputTokens: 64,
        temperature: 0.2,
        topP: 0.9,
        stopSequences: ["END"],
        responseMimeType: "application/json",
      },
    },
    "mock/mock-small",
    false
  );

  assert.deepEqual(result, {
    model: "mock/mock-small",
    messages: [
      { role: "system", content: "Be brief.\nBe kind." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ],
    max_tokens: 64,
    temperature: 0.2,
    top_p: 0.9,
    stop: ["END"],
    response_format: { type: "json_object" },
  });
});

test("Gemini -> OpenAI accepts REST snake_case system_instruction and sets stream only when streaming", () => {
  const body = {
    system_instruction: { parts: [{ text: "Rules" }] },
    contents: [{ role: "user", parts: [{ text: "Hi" }] }],
  };

  const nonStreaming = geminiToOpenAIChatRequest(body, "m", false);
  assert.deepEqual(nonStreaming.messages[0], { role: "system", content: "Rules" });
  assert.equal("stream" in nonStreaming, false);

  assert.equal(geminiToOpenAIChatRequest(body, "m", true).stream, true);
});

test("Gemini -> OpenAI converts inlineData images to image_url data URLs", () => {
  const result = geminiToOpenAIChatRequest(
    {
      contents: [
        {
          role: "user",
          parts: [
            { text: "What is this?" },
            { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
            { inline_data: { mime_type: "image/webp", data: "REVG" } },
          ],
        },
      ],
    },
    "m",
    false
  );

  assert.deepEqual(result.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
        { type: "image_url", image_url: { url: "data:image/webp;base64,REVG" } },
      ],
    },
  ]);
});

test("Gemini -> OpenAI pairs function responses with their calls and maps tools", () => {
  const result = geminiToOpenAIChatRequest(
    {
      contents: [
        { role: "user", parts: [{ text: "Weather in Paris and Rome?" }] },
        {
          role: "model",
          parts: [
            { text: "thinking", thought: true },
            { functionCall: { name: "get_weather", args: { city: "Paris" } } },
            { functionCall: { name: "get_weather", args: { city: "Rome" } } },
          ],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "get_weather", response: { temp: 18 } } },
            { functionResponse: { name: "get_weather", response: { temp: 24 } } },
          ],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "get_weather",
              description: "Get the weather",
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
    },
    "m",
    false
  );

  const assistant = result.messages[1];
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, null);
  assert.deepEqual(
    assistant.tool_calls.map((call) => [call.function.name, call.function.arguments]),
    [
      ["get_weather", '{"city":"Paris"}'],
      ["get_weather", '{"city":"Rome"}'],
    ]
  );
  const [parisId, romeId] = assistant.tool_calls.map((call) => call.id);
  assert.notEqual(parisId, romeId);
  assert.deepEqual(result.messages.slice(2), [
    { role: "tool", tool_call_id: parisId, content: '{"temp":18}' },
    { role: "tool", tool_call_id: romeId, content: '{"temp":24}' },
  ]);
  assert.deepEqual(result.tools, [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    },
  ]);
  assert.equal(result.tool_choice, "required");
});

test("Gemini -> OpenAI reuses function call ids sent by the client", () => {
  const result = geminiToOpenAIChatRequest(
    {
      contents: [
        { role: "model", parts: [{ functionCall: { id: "call_x", name: "f", args: {} } }] },
        {
          role: "user",
          parts: [{ functionResponse: { id: "call_x", name: "f", response: "ok" } }],
        },
      ],
    },
    "m",
    false
  );

  assert.equal(result.messages[0].tool_calls[0].id, "call_x");
  assert.deepEqual(result.messages[1], { role: "tool", tool_call_id: "call_x", content: "ok" });
});

test("estimateGeminiTokens counts contents and the wrapped generateContentRequest form", () => {
  assert.equal(estimateGeminiTokens({ contents: [{ parts: [{ text: "abcdefgh" }] }] }), 2);
  assert.equal(
    estimateGeminiTokens({
      generateContentRequest: {
        systemInstruction: { parts: [{ text: "abcd" }] },
        contents: [{ parts: [{ text: "abcdefgh" }] }],
      },
    }),
    3
  );
  assert.equal(estimateGeminiTokens({}), 0);
});

// ── Response ─────────────────────────────────────────────────────────────────

test("finish reasons map to Gemini enums", () => {
  assert.equal(toGeminiFinishReason("stop"), "STOP");
  assert.equal(toGeminiFinishReason("length"), "MAX_TOKENS");
  assert.equal(toGeminiFinishReason("content_filter"), "SAFETY");
  assert.equal(toGeminiFinishReason("tool_calls"), "STOP");
  assert.equal(toGeminiFinishReason(null), "STOP");
});

test("usage maps to usageMetadata and separates reasoning tokens", () => {
  assert.deepEqual(
    toGeminiUsageMetadata({ prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 }),
    { promptTokenCount: 7, candidatesTokenCount: 5, totalTokenCount: 12 }
  );
  assert.deepEqual(
    toGeminiUsageMetadata({
      prompt_tokens: 10,
      completion_tokens: 30,
      total_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 12 },
      prompt_tokens_details: { cached_tokens: 4 },
    }),
    {
      promptTokenCount: 10,
      candidatesTokenCount: 18,
      totalTokenCount: 40,
      thoughtsTokenCount: 12,
      cachedContentTokenCount: 4,
    }
  );
  assert.equal(toGeminiUsageMetadata(null), null);
});

test("OpenAI chat.completion -> GenerateContentResponse", () => {
  const result = openAIToGeminiResponse(
    {
      id: "chatcmpl-1",
      model: "mock-small",
      choices: [
        { index: 0, message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    },
    "mock/mock-small"
  );

  assert.deepEqual(result, {
    candidates: [
      { content: { role: "model", parts: [{ text: "Hi!" }] }, finishReason: "STOP", index: 0 },
    ],
    usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 5, totalTokenCount: 12 },
    modelVersion: "mock-small",
    responseId: "chatcmpl-1",
  });
});

test("OpenAI chat.completion -> Gemini maps reasoning, tool calls and truncation", () => {
  const result = openAIToGeminiResponse(
    {
      choices: [
        {
          message: {
            role: "assistant",
            reasoning_content: "let me think",
            content: null,
            tool_calls: [
              { id: "call_1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    "fallback-model"
  );

  assert.deepEqual(result.candidates[0].content.parts, [
    { text: "let me think", thought: true },
    { functionCall: { id: "call_1", name: "get_weather", args: { city: "Paris" } } },
  ]);
  assert.equal(result.candidates[0].finishReason, "STOP");
  assert.equal(result.modelVersion, "fallback-model");
  assert.equal("usageMetadata" in result, false);

  const truncated = openAIToGeminiResponse({
    choices: [{ message: { content: "cut" }, finish_reason: "length" }],
  });
  assert.equal(truncated.candidates[0].finishReason, "MAX_TOKENS");

  // No content at all still yields one (empty) text part so parts[0].text is readable.
  const empty = openAIToGeminiResponse({ choices: [{ message: {}, finish_reason: "stop" }] });
  assert.deepEqual(empty.candidates[0].content.parts, [{ text: "" }]);
});

test("errors use Google's shape and status names", () => {
  assert.deepEqual(buildGeminiErrorBody(400, "bad"), {
    error: { code: 400, message: "bad", status: "INVALID_ARGUMENT" },
  });
  assert.equal(buildGeminiErrorBody(401, "x").error.status, "UNAUTHENTICATED");
  assert.equal(buildGeminiErrorBody(403, "x").error.status, "PERMISSION_DENIED");
  assert.equal(buildGeminiErrorBody(404, "x").error.status, "NOT_FOUND");
  assert.equal(buildGeminiErrorBody(429, "x").error.status, "RESOURCE_EXHAUSTED");
  assert.equal(buildGeminiErrorBody(500, "x").error.status, "INTERNAL");
  assert.equal(buildGeminiErrorBody(503, "x").error.status, "UNAVAILABLE");
  assert.equal(buildGeminiErrorBody(504, "x").error.status, "DEADLINE_EXCEEDED");
  assert.equal(buildGeminiErrorBody(418, "x").error.status, "INVALID_ARGUMENT");
  assert.equal(buildGeminiErrorBody(599, "x").error.status, "INTERNAL");
});

// ── transformToGemini ────────────────────────────────────────────────────────

test("transformToGemini converts a JSON completion for :generateContent", async () => {
  const response = await transformToGemini(
    new Response(
      JSON.stringify({
        id: "chatcmpl-1",
        model: "mock-small",
        choices: [
          { index: 0, message: { role: "assistant", content: "MOCK:hi" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "X-CoolRouter-Cache": "MISS" },
      }
    ),
    { model: "mock/mock-small", stream: false, sse: false }
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("x-coolrouter-cache"), "MISS");
  const body = await response.json();
  assert.equal(body.candidates[0].content.parts[0].text, "MOCK:hi");
  assert.equal(body.candidates[0].finishReason, "STOP");
  assert.deepEqual(body.usageMetadata, {
    promptTokenCount: 7,
    candidatesTokenCount: 5,
    totalTokenCount: 12,
  });
});

test("transformToGemini streams SSE events for :streamGenerateContent?alt=sse", async () => {
  const response = await transformToGemini(
    sseResponse([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Hel" }),
      chunk({ content: "lo" }),
      chunk({}, "stop", { usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } }),
    ]),
    { model: "mock/mock-small", stream: true, sse: true }
  );

  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.equal(text.includes("[DONE]"), false);
  assert.equal(text.includes("chat.completion.chunk"), false);

  const events = parseSseEvents(text);
  assert.deepEqual(
    events.map((event) => event.candidates[0].content.parts[0].text),
    ["Hel", "lo", ""]
  );
  assert.equal(events[0].candidates[0].content.role, "model");
  assert.equal("finishReason" in events[0].candidates[0], false);
  assert.equal("usageMetadata" in events[0], false);

  const last = events.at(-1);
  assert.equal(last.candidates[0].finishReason, "STOP");
  assert.deepEqual(last.usageMetadata, {
    promptTokenCount: 7,
    candidatesTokenCount: 5,
    totalTokenCount: 12,
  });
  assert.equal(last.modelVersion, "mock-small");
});

test("transformToGemini emits a JSON array when alt=sse is absent", async () => {
  const response = await transformToGemini(
    sseResponse([chunk({ content: "A" }), chunk({ content: "B" }), chunk({}, "length")]),
    { model: "m", stream: true, sse: false }
  );

  assert.match(response.headers.get("content-type"), /application\/json/);
  const chunks = JSON.parse(await response.text());
  assert.equal(Array.isArray(chunks), true);
  assert.deepEqual(
    chunks.map((item) => item.candidates[0].content.parts[0].text),
    ["A", "B", ""]
  );
  assert.equal(chunks.at(-1).candidates[0].finishReason, "MAX_TOKENS");
});

test("transformToGemini keeps a usage chunk that arrives after the finish chunk", async () => {
  const response = await transformToGemini(
    sseResponse([
      chunk({ content: "Hi" }),
      chunk({}, "stop"),
      {
        id: "chatcmpl-1",
        model: "mock-small",
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      },
    ]),
    { model: "m", stream: true, sse: true }
  );

  const events = parseSseEvents(await response.text());
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].usageMetadata, {
    promptTokenCount: 3,
    candidatesTokenCount: 1,
    totalTokenCount: 4,
  });
});

test("transformToGemini assembles streamed tool calls into functionCall parts", async () => {
  const response = await transformToGemini(
    sseResponse([
      chunk({ role: "assistant", content: "" }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_abc",
            type: "function",
            function: { name: "get_weather", arguments: "" },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] }),
      chunk({}, "tool_calls"),
    ]),
    { model: "m", stream: true, sse: true }
  );

  const events = parseSseEvents(await response.text());
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].candidates[0].content.parts, [
    { functionCall: { id: "call_abc", name: "get_weather", args: { city: "Paris" } } },
  ]);
  assert.equal(events[0].candidates[0].finishReason, "STOP");
});

test("transformToGemini still finishes a stream that ends without [DONE]", async () => {
  const response = await transformToGemini(
    sseResponse([chunk({ content: "partial" })], { done: false }),
    { model: "m", stream: true, sse: false }
  );

  const chunks = JSON.parse(await response.text());
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].candidates[0].finishReason, "STOP");
});

test("createOpenAIToGeminiStream handles events and characters split across chunks", async () => {
  const payload = `data: ${JSON.stringify(chunk({ content: "héllo ✓" }))}\n\ndata: [DONE]\n\n`;
  const bytes = encoder.encode(payload);
  // Cut inside the two-byte "é" so a per-chunk decoder would corrupt it.
  const cut = bytes.indexOf(0xc3) + 1;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });

  const text = await new Response(
    source.pipeThrough(createOpenAIToGeminiStream("m", { sse: true }))
  ).text();
  const events = parseSseEvents(text);
  assert.equal(events[0].candidates[0].content.parts[0].text, "héllo ✓");
});

test("transformToGemini reshapes pipeline errors and keeps the status", async () => {
  const response = await transformToGemini(
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
    { model: "m", stream: true, sse: true }
  );

  assert.equal(response.status, 401);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), {
    error: { code: 401, message: "Invalid API key", status: "UNAUTHENTICATED" },
  });

  const unavailable = await transformToGemini(
    new Response(JSON.stringify({ error: { message: "cooldown" } }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "30" },
    }),
    { model: "m", stream: false, sse: false }
  );
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "30");
  assert.equal((await unavailable.json()).error.status, "UNAVAILABLE");
});

test("transformToGemini frames a JSON answer as a one-chunk stream when streaming was requested", async () => {
  const completion = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "replayed" }, finish_reason: "stop" }],
  });
  const json = () =>
    new Response(completion, { status: 200, headers: { "Content-Type": "application/json" } });

  const sse = await transformToGemini(json(), { model: "m", stream: true, sse: true });
  const events = parseSseEvents(await sse.text());
  assert.equal(events.length, 1);
  assert.equal(events[0].candidates[0].content.parts[0].text, "replayed");

  const array = await transformToGemini(json(), { model: "m", stream: true, sse: false });
  const chunks = JSON.parse(await array.text());
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].candidates[0].content.parts[0].text, "replayed");
});
