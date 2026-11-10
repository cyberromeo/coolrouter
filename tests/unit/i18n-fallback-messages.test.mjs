import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { withFallbackMessages } = await import("../../src/i18n/fallbackMessages.ts");

const MESSAGES_DIR = path.join(process.cwd(), "src/i18n/messages");
const readMessages = (locale) =>
  JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8"));

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
}

test("untranslated keys fall back to English and translations win", () => {
  const english = { auth: { signIn: "Sign in", continue: "Continue" }, updates: { a: "A" } };
  const locale = { auth: { signIn: "Anmelden" } };

  assert.deepEqual(withFallbackMessages(english, locale), {
    auth: { signIn: "Anmelden", continue: "Continue" },
    updates: { a: "A" },
  });
  assert.deepEqual(locale, { auth: { signIn: "Anmelden" } }, "inputs are not mutated");
  assert.deepEqual(english.auth, { signIn: "Sign in", continue: "Continue" });
});

test("locale-only keys and non-object overrides are kept as-is", () => {
  const merged = withFallbackMessages({ a: { b: "x" }, list: "text" }, { a: "flat", extra: "y" });
  assert.deepEqual(merged, { a: "flat", list: "text", extra: "y" });
});

test("every shipped locale resolves every English key once merged", () => {
  const english = readMessages("en");
  const englishKeys = flatten(english);
  const locales = fs
    .readdirSync(MESSAGES_DIR)
    .filter((file) => file.endsWith(".json") && file !== "en.json")
    .map((file) => file.replace(/\.json$/, ""));

  assert.ok(locales.length > 0);
  for (const locale of locales) {
    const mergedKeys = new Set(flatten(withFallbackMessages(english, readMessages(locale))));
    const missing = englishKeys.filter((key) => !mergedKeys.has(key));
    assert.deepEqual(missing, [], `${locale} is missing keys after fallback merge`);
  }
});
