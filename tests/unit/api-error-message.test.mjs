import test from "node:test";
import assert from "node:assert/strict";

const { getApiErrorMessage, readApiError } =
  await import("../../src/shared/utils/apiErrorMessage.ts");

test("getApiErrorMessage returns plain string errors unchanged", () => {
  assert.equal(getApiErrorMessage({ error: "Invalid password" }), "Invalid password");
  assert.equal(getApiErrorMessage("boom"), "boom");
});

test("getApiErrorMessage prefers the first validation detail over the generic wrapper", () => {
  const payload = {
    error: {
      message: "Invalid request",
      details: [{ field: "password", message: "Password must be at least 4 characters" }],
    },
  };
  assert.equal(getApiErrorMessage(payload), "Password must be at least 4 characters");
});

test("getApiErrorMessage reads the auth gate { code, message } shape", () => {
  const payload = { error: { code: "AUTH_001", message: "Authentication required" } };
  assert.equal(getApiErrorMessage(payload), "Authentication required");
});

test("getApiErrorMessage falls back for empty, null and unknown shapes", () => {
  assert.equal(getApiErrorMessage(null, "fallback"), "fallback");
  assert.equal(getApiErrorMessage({}, "fallback"), "fallback");
  assert.equal(getApiErrorMessage({ error: {} }, "fallback"), "fallback");
  assert.equal(getApiErrorMessage({ error: "   " }, "fallback"), "fallback");
  assert.equal(getApiErrorMessage({ message: "legacy text" }, "fallback"), "legacy text");
});

test("getApiErrorMessage never returns a non-string", () => {
  for (const payload of [{ error: { details: [{}] } }, { error: 42 }, [], 7, undefined]) {
    assert.equal(typeof getApiErrorMessage(payload, "fallback"), "string");
  }
});

test("readApiError survives empty and non-JSON bodies", async () => {
  assert.equal(await readApiError(new Response("", { status: 500 }), "fallback"), "fallback");
  assert.equal(
    await readApiError(new Response("<html>502 Bad Gateway</html>", { status: 502 }), "fallback"),
    "fallback"
  );
  assert.equal(
    await readApiError(new Response(JSON.stringify({ error: "Nope" }), { status: 400 })),
    "Nope"
  );
});
