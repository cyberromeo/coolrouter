import test from "node:test";
import assert from "node:assert/strict";

const { buildClaudeErrorBody, toClaudeErrorResponse, errorResponse, unavailableResponse } =
  await import("../../open-sse/utils/error.ts");

test("buildClaudeErrorBody uses the Anthropic error envelope and type names", () => {
  assert.deepEqual(buildClaudeErrorBody(401, "Invalid API key"), {
    type: "error",
    error: { type: "authentication_error", message: "Invalid API key" },
  });
  assert.equal(buildClaudeErrorBody(400, "x").error.type, "invalid_request_error");
  assert.equal(buildClaudeErrorBody(403, "x").error.type, "permission_error");
  assert.equal(buildClaudeErrorBody(404, "x").error.type, "not_found_error");
  assert.equal(buildClaudeErrorBody(413, "x").error.type, "request_too_large");
  assert.equal(buildClaudeErrorBody(429, "x").error.type, "rate_limit_error");
  assert.equal(buildClaudeErrorBody(500, "x").error.type, "api_error");
  assert.equal(buildClaudeErrorBody(502, "x").error.type, "api_error");
  assert.equal(buildClaudeErrorBody(503, "x").error.type, "overloaded_error");
  assert.equal(buildClaudeErrorBody(529, "x").error.type, "overloaded_error");
  assert.equal(buildClaudeErrorBody(422, "x").error.type, "invalid_request_error");
  // Falls back to the default message for the status.
  assert.equal(buildClaudeErrorBody(429).error.message, "Rate limit exceeded");
});

test("toClaudeErrorResponse reshapes an OpenAI-style error and keeps status and headers", async () => {
  const original = errorResponse(401, "Invalid API key");
  original.headers.set("X-CoolRouter-Session-Id", "abc123");

  const response = await toClaudeErrorResponse(original);

  assert.equal(response.status, 401);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("x-coolrouter-session-id"), "abc123");
  assert.deepEqual(await response.json(), {
    type: "error",
    error: { type: "authentication_error", message: "Invalid API key" },
  });
});

test("toClaudeErrorResponse handles the unavailable response and keeps Retry-After", async () => {
  const response = await toClaudeErrorResponse(
    unavailableResponse(503, "[provider/model] upstream exploded", null, "reset after 30s")
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.deepEqual(await response.json(), {
    type: "error",
    error: {
      type: "overloaded_error",
      message: "[provider/model] upstream exploded (reset after 30s)",
    },
  });
});

test("toClaudeErrorResponse accepts string errors and typed translation errors", async () => {
  const stringError = await toClaudeErrorResponse(
    new Response(JSON.stringify({ error: "Model not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  );
  assert.deepEqual(await stringError.json(), {
    type: "error",
    error: { type: "permission_error", message: "Model not allowed" },
  });

  const typed = await toClaudeErrorResponse(
    new Response(
      JSON.stringify({
        error: { message: "unsupported", type: "unsupported_feature", code: "unsupported_feature" },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  );
  assert.deepEqual(await typed.json(), {
    type: "error",
    error: { type: "invalid_request_error", message: "unsupported" },
  });
});

test("toClaudeErrorResponse leaves successes, streams and Anthropic-shaped errors alone", async () => {
  const ok = new Response(JSON.stringify({ type: "message" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(await toClaudeErrorResponse(ok), ok);

  const html = new Response("<html>Bad gateway</html>", {
    status: 502,
    headers: { "Content-Type": "text/html" },
  });
  assert.equal(await toClaudeErrorResponse(html), html);

  const alreadyShaped = {
    type: "error",
    error: { type: "overloaded_error", message: "Overloaded" },
  };
  const passthrough = await toClaudeErrorResponse(
    new Response(JSON.stringify(alreadyShaped), {
      status: 529,
      headers: { "Content-Type": "application/json" },
    })
  );
  assert.equal(passthrough.status, 529);
  assert.deepEqual(await passthrough.json(), alreadyShaped);
});
