import test from "node:test";
import assert from "node:assert/strict";

const { convertOpenAINonStreamingToResponses } =
  await import("../../open-sse/handlers/responseTranslator.ts");

// What the official OpenAI SDKs compute for `response.output_text`.
function outputText(response) {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

test("chat.completion -> Responses object carries the text as an output_text message", () => {
  const result = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-abc",
    object: "chat.completion",
    created: 1700000000,
    model: "gpt-4o-mini",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello there" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  });

  assert.deepEqual(result, {
    id: "resp_chatcmpl-abc",
    object: "response",
    created_at: 1700000000,
    status: "completed",
    error: null,
    incomplete_details: null,
    model: "gpt-4o-mini",
    output: [
      {
        id: "msg_resp_chatcmpl-abc_0",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello there", annotations: [] }],
      },
    ],
    usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 },
  });
  assert.equal(outputText(result), "Hello there");
});

test("chat.completion -> Responses object accepts usage already in Responses field names", () => {
  // chatCore filters usage to input_/output_tokens before the final conversion.
  const result = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-usage",
    choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: {
      input_tokens: 2007,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 3 },
      estimated: true,
    },
  });

  assert.deepEqual(result.usage, {
    input_tokens: 2007,
    output_tokens: 5,
    total_tokens: 2012,
    input_tokens_details: { cached_tokens: 3 },
    estimated: true,
  });
});

test("chat.completion -> Responses object maps cached and reasoning token details", () => {
  const result = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-details",
    choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 8 },
    },
  });

  assert.deepEqual(result.usage, {
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    input_tokens_details: { cached_tokens: 4 },
    output_tokens_details: { reasoning_tokens: 8 },
  });
});

test("chat.completion -> Responses object turns tool calls into function_call items", () => {
  const result = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-tools",
    model: "gpt-4o",
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, [
    {
      id: "fc_call_1",
      type: "function_call",
      status: "completed",
      call_id: "call_1",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
    },
  ]);
  assert.equal("usage" in result, false);
});

test("chat.completion -> Responses object keeps reasoning, text and tool calls in order", () => {
  const result = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-mixed",
    choices: [
      {
        message: {
          role: "assistant",
          reasoning_content: "thinking it through",
          content: "Let me check.",
          tool_calls: [{ id: "call_9", function: { name: "lookup", arguments: { q: "x" } } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });

  assert.deepEqual(
    result.output.map((item) => item.type),
    ["reasoning", "message", "function_call"]
  );
  assert.deepEqual(result.output[0].summary, [
    { type: "summary_text", text: "thinking it through" },
  ]);
  assert.equal(outputText(result), "Let me check.");
  assert.equal(result.output[2].arguments, '{"q":"x"}');
});

test("chat.completion -> Responses object reports truncation as incomplete", () => {
  const truncated = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-len",
    choices: [{ message: { role: "assistant", content: "cut off" }, finish_reason: "length" }],
  });
  assert.equal(truncated.status, "incomplete");
  assert.deepEqual(truncated.incomplete_details, { reason: "max_output_tokens" });
  assert.equal(truncated.output[0].status, "incomplete");

  const filtered = convertOpenAINonStreamingToResponses({
    id: "chatcmpl-filter",
    choices: [{ message: { role: "assistant", content: "" }, finish_reason: "content_filter" }],
  });
  assert.equal(filtered.status, "incomplete");
  assert.deepEqual(filtered.incomplete_details, { reason: "content_filter" });
});

test("chat.completion -> Responses object always has a message item for a text turn", () => {
  const result = convertOpenAINonStreamingToResponses({
    id: "resp_already-prefixed",
    choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
  });

  assert.equal(result.id, "resp_already-prefixed");
  assert.deepEqual(result.output[0].content, [{ type: "output_text", text: "", annotations: [] }]);
});

test("payloads that are not chat completions pass through unchanged", () => {
  const native = {
    id: "resp_native",
    object: "response",
    output: [{ type: "message", content: [{ type: "output_text", text: "native" }] }],
  };
  assert.equal(convertOpenAINonStreamingToResponses(native), native);
  assert.equal(convertOpenAINonStreamingToResponses(null), null);
});
