import test from "node:test";
import assert from "node:assert/strict";

const { textCompletionToChatRequest, chatToTextCompletionResponse, transformToTextCompletion } =
  await import("../../open-sse/utils/textCompletionTransform.ts");

function sseResponse(events) {
  const body =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function chunk(delta, finishReason = null, extra = {}) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "mock-small",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  };
}

test("legacy request -> chat request turns the prompt into a user message", () => {
  const result = textCompletionToChatRequest({
    model: "mock/mock-small",
    prompt: "say hi",
    max_tokens: 16,
    temperature: 0,
    stream: true,
  });

  assert.deepEqual(result, {
    model: "mock/mock-small",
    max_tokens: 16,
    temperature: 0,
    stream: true,
    messages: [{ role: "user", content: "say hi" }],
  });
});

test("legacy request -> chat request joins prompt arrays and drops legacy-only parameters", () => {
  const result = textCompletionToChatRequest({
    model: "m",
    prompt: ["line one", "line two"],
    echo: true,
    suffix: "!",
    best_of: 3,
    logprobs: 2,
  });

  assert.deepEqual(result, {
    model: "m",
    messages: [{ role: "user", content: "line one\nline two" }],
  });
});

test("chat.completion -> text_completion", () => {
  const result = chatToTextCompletionResponse({
    id: "chatcmpl-abc",
    object: "chat.completion",
    created: 1700000000,
    model: "mock-small",
    choices: [
      { index: 0, message: { role: "assistant", content: "MOCK:say hi" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  });

  assert.deepEqual(result, {
    id: "cmpl-abc",
    object: "text_completion",
    created: 1700000000,
    model: "mock-small",
    choices: [{ text: "MOCK:say hi", index: 0, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  });
});

test("chat.completion -> text_completion leaves other payloads alone", () => {
  const other = { object: "list", data: [] };
  assert.equal(chatToTextCompletionResponse(other), other);
});

test("transformToTextCompletion converts a JSON completion", async () => {
  const response = await transformToTextCompletion(
    new Response(
      JSON.stringify({
        id: "chatcmpl-1",
        model: "mock-small",
        choices: [
          { index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "length" },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "X-CoolRouter-Cache": "MISS" },
      }
    )
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-coolrouter-cache"), "MISS");
  const body = await response.json();
  assert.equal(body.object, "text_completion");
  assert.equal(body.choices[0].text, "hello");
  assert.equal(body.choices[0].finish_reason, "length");
  assert.equal("message" in body.choices[0], false);
});

test("transformToTextCompletion converts streamed chunks and keeps [DONE]", async () => {
  const response = await transformToTextCompletion(
    sseResponse([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Hel" }),
      chunk({ content: "lo" }),
      chunk({}, "stop", { usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } }),
    ])
  );

  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.equal(text.endsWith("data: [DONE]\n\n"), true);
  assert.equal(text.includes("chat.completion.chunk"), false);

  const events = text
    .split("\n\n")
    .filter((block) => block.startsWith("data: {"))
    .map((block) => JSON.parse(block.slice("data: ".length)));

  // The role-only opening chunk has no legacy counterpart.
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => [event.object, event.choices[0].text, event.choices[0].finish_reason]),
    [
      ["text_completion", "Hel", null],
      ["text_completion", "lo", null],
      ["text_completion", "", "stop"],
    ]
  );
  assert.equal(events[0].id, "cmpl-1");
  assert.deepEqual(events[2].usage, { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 });
});

test("transformToTextCompletion passes error responses through untouched", async () => {
  const error = new Response(
    JSON.stringify({ error: { message: "Invalid API key", type: "authentication_error" } }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

  const response = await transformToTextCompletion(error);
  assert.equal(response, error);
  assert.equal(response.status, 401);
});
