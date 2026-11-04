import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COOLROUTER_BASE_URL,
  resolveCoolRouterBaseUrl,
} from "../../src/shared/utils/resolveCoolRouterBaseUrl.ts";

test("resolveCoolRouterBaseUrl prefers COOLROUTER_BASE_URL", () => {
  assert.equal(
    resolveCoolRouterBaseUrl({
      COOLROUTER_BASE_URL: "https://internal.example.com/",
      BASE_URL: "https://base.example.com",
      NEXT_PUBLIC_BASE_URL: "https://public.example.com",
    }),
    "https://internal.example.com"
  );
});

test("resolveCoolRouterBaseUrl falls back to BASE_URL", () => {
  assert.equal(
    resolveCoolRouterBaseUrl({
      BASE_URL: "https://base.example.com/",
      NEXT_PUBLIC_BASE_URL: "https://public.example.com",
    }),
    "https://base.example.com"
  );
});

test("resolveCoolRouterBaseUrl falls back to NEXT_PUBLIC_BASE_URL", () => {
  assert.equal(
    resolveCoolRouterBaseUrl({
      NEXT_PUBLIC_BASE_URL: "https://public.example.com/",
    }),
    "https://public.example.com"
  );
});

test("resolveCoolRouterBaseUrl ignores blank values", () => {
  assert.equal(
    resolveCoolRouterBaseUrl({
      COOLROUTER_BASE_URL: "   ",
      BASE_URL: "",
      NEXT_PUBLIC_BASE_URL: " https://public.example.com/ ",
    }),
    "https://public.example.com"
  );
});

test("resolveCoolRouterBaseUrl uses the default localhost fallback", () => {
  assert.equal(resolveCoolRouterBaseUrl({}), DEFAULT_COOLROUTER_BASE_URL);
});
