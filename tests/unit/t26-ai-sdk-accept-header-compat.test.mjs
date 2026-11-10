import test from "node:test";
import assert from "node:assert/strict";

const {
  clientWantsJsonResponse,
  clientAcceptsEventStream,
  resolveStreamFlag,
  resolveExplicitStreamAlias,
  hasExplicitNoStreamParam,
  stripMarkdownCodeFence,
} = await import("../../open-sse/utils/aiSdkCompat.ts");

// Client formats whose specs make `stream` optional with a default of false.
const SPEC_NON_STREAMING_FORMATS = ["openai", "openai-responses", "claude"];
// Formats with no `stream` field of their own (the URL decides) keep the legacy default.
const LEGACY_DEFAULT_FORMATS = ["gemini", "gemini-cli", "antigravity"];

test("T26: explicit stream:true takes priority over Accept application/json (#656)", () => {
  assert.equal(clientWantsJsonResponse("application/json"), true);
  // Body stream:true always wins — even with Accept: application/json
  assert.equal(resolveStreamFlag(true, "application/json"), true);
  for (const format of [...SPEC_NON_STREAMING_FORMATS, ...LEGACY_DEFAULT_FORMATS]) {
    assert.equal(resolveStreamFlag(true, "application/json", format), true, format);
  }
});

test("T26: text/event-stream keeps SSE behavior", () => {
  assert.equal(clientWantsJsonResponse("text/event-stream"), false);
  assert.equal(clientAcceptsEventStream("text/event-stream"), true);
  assert.equal(resolveStreamFlag(true, "text/event-stream"), true);
});

test("T26: mixed Accept header prefers SSE only when text/event-stream is present", () => {
  assert.equal(clientWantsJsonResponse("application/json, text/event-stream"), false);
  assert.equal(clientAcceptsEventStream("application/json, Text/Event-Stream"), true);
  assert.equal(clientAcceptsEventStream("application/json"), false);
  assert.equal(clientAcceptsEventStream("*/*"), false);
  assert.equal(clientAcceptsEventStream(undefined), false);
  assert.equal(resolveStreamFlag(true, "application/json, text/event-stream"), true);
});

test("T26: markdown code fence stripping unwraps Claude JSON blocks", () => {
  const wrapped = '```json\n{"name":"coolrouter"}\n```';
  assert.equal(stripMarkdownCodeFence(wrapped), '{"name":"coolrouter"}');
});

test("T26: non-fenced content is returned unchanged", () => {
  const plain = '{"name":"coolrouter"}';
  assert.equal(stripMarkdownCodeFence(plain), plain);
});

test("T26: omitted stream is non-streaming for OpenAI, Responses and Anthropic clients", () => {
  // Per spec `stream` defaults to false. curl, fetch and Python requests send a wildcard
  // Accept (or none), which must not turn the response into SSE.
  for (const format of SPEC_NON_STREAMING_FORMATS) {
    assert.equal(resolveStreamFlag(undefined, "*/*", format), false, `${format} */*`);
    assert.equal(resolveStreamFlag(undefined, undefined, format), false, `${format} no Accept`);
    assert.equal(resolveStreamFlag(undefined, "", format), false, `${format} empty Accept`);
    assert.equal(
      resolveStreamFlag(undefined, "application/json", format),
      false,
      `${format} application/json`
    );
  }
});

test("T26: omitted stream follows an explicit Accept: text/event-stream for spec formats", () => {
  for (const format of SPEC_NON_STREAMING_FORMATS) {
    assert.equal(resolveStreamFlag(undefined, "text/event-stream", format), true, format);
    assert.equal(
      resolveStreamFlag(undefined, "application/json, text/event-stream", format),
      true,
      format
    );
  }
});

test("T26: omitted stream keeps the legacy default for formats without a stream field (#656)", () => {
  // Gemini-style clients choose the mode with the URL, so their bodies never carry `stream`:
  // stream unless the client explicitly prefers JSON. Same when no format is given.
  for (const format of [...LEGACY_DEFAULT_FORMATS, undefined]) {
    assert.equal(resolveStreamFlag(undefined, "application/json", format), false, String(format));
    assert.equal(resolveStreamFlag(undefined, "text/event-stream", format), true, String(format));
    assert.equal(resolveStreamFlag(undefined, "*/*", format), true, String(format));
    assert.equal(resolveStreamFlag(undefined, undefined, format), true, String(format));
  }
});

test("T26: explicit stream:false always prevents streaming", () => {
  assert.equal(resolveStreamFlag(false, "text/event-stream"), false);
  assert.equal(resolveStreamFlag(false, undefined), false);
  for (const format of [...SPEC_NON_STREAMING_FORMATS, ...LEGACY_DEFAULT_FORMATS]) {
    assert.equal(resolveStreamFlag(false, "text/event-stream", format), false, format);
  }
});

test("T26: explicit non-stream aliases are detected", () => {
  assert.equal(hasExplicitNoStreamParam({ non_stream: true }), true);
  assert.equal(hasExplicitNoStreamParam({ disable_stream: true }), true);
  assert.equal(hasExplicitNoStreamParam({ disable_streaming: true }), true);
  assert.equal(hasExplicitNoStreamParam({ streaming: false }), true);
  assert.equal(hasExplicitNoStreamParam({ streaming: true }), false);
  assert.equal(hasExplicitNoStreamParam({ stream: false }), false);
  assert.equal(hasExplicitNoStreamParam({}), false);
});

test("T26: explicit stream aliases resolve true/false correctly", () => {
  assert.equal(resolveExplicitStreamAlias({ streaming: true }), true);
  assert.equal(resolveExplicitStreamAlias({ streaming: false }), false);
  assert.equal(resolveExplicitStreamAlias({ disable_streaming: true }), false);
  assert.equal(resolveExplicitStreamAlias({}), undefined);
});
