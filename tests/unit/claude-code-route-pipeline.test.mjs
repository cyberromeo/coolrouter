// Claude Code traffic routed through Cool Router to every kind of target.
//
// Claude Code always speaks the Anthropic Messages format and names real Claude
// models (claude-opus-5-5, ...). Behind a model-map route the request may be served
// by an OpenAI-format model, Gemini, or another Claude model; these tests pin what
// reaches the upstream in each case.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "coolrouter-cc-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { invalidateCacheControlSettingsCache } =
  await import("../../src/lib/cacheControlSettings.ts");
const { clearCache } = await import("../../src/lib/semanticCache.ts");
const { clearIdempotency } = await import("../../src/lib/idempotencyLayer.ts");
const { clearInflight } = await import("../../open-sse/services/requestDedup.ts");
const { handleChatCore, clearUpstreamProxyConfigCache, mergeAnthropicBetaHeader } =
  await import("../../open-sse/handlers/chatCore.ts");
const { isClaudeCodeClient } = await import("../../open-sse/utils/cacheControlPolicy.ts");
const { shouldFallbackComboBadRequest } = await import("../../open-sse/services/combo.ts");
const { getUnsupportedParams, isOpenAIReasoningModel } =
  await import("../../open-sse/config/providerRegistry.ts");
const { openaiToClaudeResponse } =
  await import("../../open-sse/translator/response/openai-to-claude.ts");
const { initState } = await import("../../open-sse/translator/index.ts");
const { FORMATS } = await import("../../open-sse/translator/formats.ts");

const originalFetch = globalThis.fetch;
const CLAUDE_CODE_UA = "claude-cli/2.1.330 (external, cli)";

function noopLog() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function plainHeaders(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
}

function openAIJson(text = "done") {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      model: "gpt-x",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function claudeJson(text = "done") {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-x",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function geminiJson(text = "done") {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

/** A Claude Code turn that just ran a tool: thinking + tool_use, then the tool result. */
function claudeCodeToolLoopBody(overrides = {}) {
  return {
    model: "claude-opus-5-5",
    max_tokens: 32000,
    stream: false,
    system: [{ type: "text", text: "You are Claude Code", cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { effort: "xhigh" },
    context_management: { edits: [{ type: "clear_thinking_20251015" }] },
    tools: [
      {
        name: "Read",
        description: "Read a file",
        input_schema: { type: "object", properties: { file_path: { type: "string" } } },
      },
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: "What is in notes.txt?" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should read it.", signature: "sig-abc" },
          { type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "notes.txt" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "buy milk" }],
      },
    ],
    ...overrides,
  };
}

async function sendThroughChatCore({
  body,
  provider,
  model,
  endpoint = "/v1/messages",
  userAgent = CLAUDE_CODE_UA,
  requestHeaders = {},
  credentials = { apiKey: "sk-test", providerSpecificData: {} },
  respond,
  isCombo = true,
  comboStrategy = "priority",
}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const captured = {
      url: String(url),
      headers: plainHeaders(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(captured);
    return respond(captured);
  };
  try {
    const result = await handleChatCore({
      body: structuredClone(body),
      modelInfo: { provider, model, extendedContext: false },
      credentials,
      log: noopLog(),
      clientRawRequest: {
        endpoint,
        body: structuredClone(body),
        headers: { accept: "application/json", ...requestHeaders },
      },
      userAgent,
      isCombo,
      comboStrategy,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { result, call: calls.at(-1), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearUpstreamProxyConfigCache();
  invalidateCacheControlSettingsCache();
  clearCache();
  clearIdempotency();
  clearInflight();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Claude Code tool loop reaches an OpenAI model with the real tool output", async () => {
  const { result, call } = await sendThroughChatCore({
    body: claudeCodeToolLoopBody(),
    provider: "openai",
    model: "gpt-5",
    respond: () => openAIJson(),
  });

  assert.equal(result.success, true);
  const toolMessages = call.body.messages.filter((m) => m.role === "tool");
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0].tool_call_id, "toolu_01");
  assert.equal(toolMessages[0].content, "buy milk");
  const serialized = JSON.stringify(call.body.messages);
  assert.equal(serialized.includes("[No response received]"), false);
  assert.equal(serialized.includes("[Tool Result:"), false);

  // Server tools can't run on GPT; only the client tool is offered.
  assert.deepEqual(
    call.body.tools.map((t) => t.function.name),
    ["Read"]
  );
  // OpenAI rejects replayed reasoning_content and, on reasoning models, max_tokens.
  assert.equal(
    call.body.messages.some((m) => "reasoning_content" in m),
    false
  );
  assert.equal(call.body.max_tokens, undefined);
  assert.equal(typeof call.body.max_completion_tokens, "number");
});

test("Claude Code tool loop keeps reasoning_content for providers that accept it", async () => {
  const { call } = await sendThroughChatCore({
    body: claudeCodeToolLoopBody(),
    provider: "deepseek",
    model: "deepseek-chat",
    respond: () => openAIJson(),
  });
  const assistant = call.body.messages.find((m) => m.role === "assistant");
  assert.equal(assistant.reasoning_content, "I should read it.");
  assert.equal(call.body.messages.find((m) => m.role === "tool").content, "buy milk");
});

test("Claude Code tool loop reaches Gemini as a paired functionCall/functionResponse", async () => {
  const { result, call } = await sendThroughChatCore({
    body: claudeCodeToolLoopBody(),
    provider: "gemini",
    model: "gemini-2.5-pro",
    respond: () => geminiJson(),
  });

  assert.equal(result.success, true);
  const parts = call.body.contents.flatMap((c) => c.parts || []);
  const responsePart = parts.find((p) => p.functionResponse);
  assert.ok(responsePart, "functionResponse should be sent");
  assert.equal(responsePart.functionResponse.name, "Read");
  assert.deepEqual(responsePart.functionResponse.response, { result: { result: "buy milk" } });
  const declared = call.body.tools[0].functionDeclarations.map((d) => d.name);
  assert.deepEqual(declared, ["Read"]);
});

test("Claude Code → Anthropic API key is a passthrough with its beta header", async () => {
  const { result, call } = await sendThroughChatCore({
    body: claudeCodeToolLoopBody(),
    provider: "anthropic",
    model: "claude-opus-5-5",
    requestHeaders: {
      "anthropic-beta": "context-management-2025-06-27,oauth-2025-04-20,effort-2025-11-24",
    },
    respond: () => claudeJson(),
  });

  assert.equal(result.success, true);
  // Nothing Claude Code relies on was dropped by an OpenAI round trip.
  assert.deepEqual(call.body.thinking, { type: "adaptive" });
  assert.deepEqual(call.body.output_config, { effort: "xhigh" });
  assert.ok(call.body.context_management);
  assert.ok(call.body.tools.some((t) => t.type === "web_search_20250305"));
  assert.deepEqual(call.body.system[0].cache_control, { type: "ephemeral" });
  assert.equal(call.body.messages.at(-1).content[0].type, "tool_result");
  // Betas forwarded, minus the claude.ai OAuth beta an API key can't use.
  assert.equal(call.headers["anthropic-beta"], "context-management-2025-06-27,effort-2025-11-24");
});

test("Anthropic passthrough adapts a newer-model request to an older Claude target", async () => {
  const body = claudeCodeToolLoopBody();
  // History replayed from a non-Claude fallback: thinking without a signature.
  body.messages[1].content.unshift({ type: "thinking", thinking: "from gpt" });

  const { call } = await sendThroughChatCore({
    body,
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    respond: () => claudeJson(),
  });

  assert.equal(call.body.thinking.type, "enabled");
  assert.ok(call.body.thinking.budget_tokens >= 1024);
  assert.equal(call.body.output_config, undefined);
  const thinkingBlocks = call.body.messages[1].content.filter((b) => b.type === "thinking");
  assert.equal(thinkingBlocks.length, 1);
  assert.equal(thinkingBlocks[0].signature, "sig-abc");
});

test("Codex Responses request reaches a strict Chat provider without Responses-only fields", async () => {
  const { result, call } = await sendThroughChatCore({
    endpoint: "/v1/responses",
    userAgent: "codex_cli_rs/0.140.0",
    provider: "mistral",
    model: "mistral-large-latest",
    isCombo: false,
    comboStrategy: null,
    body: {
      model: "sonnet",
      stream: false,
      instructions: "You are Codex",
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      prompt_cache_key: "session-1",
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "answer", schema: { type: "object" } },
      },
      truncation: "auto",
      parallel_tool_calls: false,
    },
    respond: () => openAIJson(),
  });

  assert.equal(result.success, true);
  assert.ok(Array.isArray(call.body.messages));
  for (const field of ["text", "truncation", "prompt_cache_key", "input", "instructions"]) {
    assert.equal(field in call.body, false, `${field} should not reach Mistral`);
  }
  assert.deepEqual(call.body.response_format, {
    type: "json_schema",
    json_schema: { name: "answer", schema: { type: "object" } },
  });
  assert.equal(call.body.parallel_tool_calls, false);
});

test("Claude Code's real user agent is recognised", () => {
  assert.equal(isClaudeCodeClient(CLAUDE_CODE_UA), true);
  assert.equal(isClaudeCodeClient("claude-cli/2.1.330 (external, claude-desktop)"), true);
  assert.equal(isClaudeCodeClient("python-requests/2.32"), false);
});

test("anthropic-beta merge keeps provider defaults and drops OAuth betas for API keys", () => {
  assert.equal(mergeAnthropicBetaHeader("anthropic", null), null);
  assert.equal(mergeAnthropicBetaHeader("anthropic", "oauth-2025-04-20"), null);
  const merged = mergeAnthropicBetaHeader("claude", "effort-2025-11-24,oauth-2025-04-20");
  assert.ok(merged.startsWith("claude-code-20250219,oauth-2025-04-20"));
  assert.ok(merged.endsWith(",effort-2025-11-24"));
  assert.equal(merged.split(",").filter((b) => b === "oauth-2025-04-20").length, 1);
});

test("model-local 400s fall through to the next model on the route", () => {
  assert.equal(
    shouldFallbackComboBadRequest(400, "This model's maximum context length is 128000 tokens"),
    true
  );
  assert.equal(shouldFallbackComboBadRequest(422, "Extra inputs are not permitted"), true);
  assert.equal(shouldFallbackComboBadRequest(400, "This model does not support image input"), true);
  assert.equal(shouldFallbackComboBadRequest(400, "Unsupported parameter: 'max_tokens'"), true);
  assert.equal(shouldFallbackComboBadRequest(401, "context length exceeded"), false);
  assert.equal(shouldFallbackComboBadRequest(400, "invalid api key"), false);
});

test("OpenAI reasoning families drop sampling parameters; chat variants keep them", () => {
  assert.equal(isOpenAIReasoningModel("gpt-5.1-codex"), true);
  assert.equal(isOpenAIReasoningModel("o4-mini"), true);
  assert.equal(isOpenAIReasoningModel("gpt-5-chat-latest"), false);
  assert.equal(isOpenAIReasoningModel("gpt-4o"), false);
  assert.ok(getUnsupportedParams("openai", "gpt-5").includes("temperature"));
  assert.deepEqual(getUnsupportedParams("openai", "gpt-5-chat-latest"), []);
  assert.deepEqual(getUnsupportedParams("deepseek", "gpt-5"), []);
});

test("an OpenAI stream that ends without finish_reason still closes the Claude message", () => {
  const state = initState(FORMATS.CLAUDE);
  const events = [
    ...openaiToClaudeResponse(
      { id: "chatcmpl-abcdefgh", model: "m", choices: [{ index: 0, delta: { content: "hi" } }] },
      state
    ),
    ...openaiToClaudeResponse(null, state),
  ];
  const types = events.map((e) => e.type);
  assert.deepEqual(types, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  assert.equal(events.at(-2).delta.stop_reason, "end_turn");
  // A second flush, or a flush after a normal finish, adds nothing.
  assert.equal(openaiToClaudeResponse(null, state), null);
});
