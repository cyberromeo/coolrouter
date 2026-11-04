import test from "node:test";
import assert from "node:assert/strict";

const sidebarVisibility = await import("../../src/shared/constants/sidebarVisibility.ts");

const ids = (sectionId) =>
  sidebarVisibility.SIDEBAR_SECTIONS.find((section) => section.id === sectionId)?.items.map(
    (item) => item.id
  );

test("primary sidebar keeps only the core gateway pages", () => {
  assert.deepEqual(ids("primary"), ["home", "providers", "combos", "api-manager", "playground"]);
});

test("monitor sidebar shows usage then logs", () => {
  assert.deepEqual(ids("monitor"), ["analytics", "logs"]);
});

test("system sidebar has settings and docs", () => {
  assert.deepEqual(ids("system"), ["settings", "docs"]);
});

test("normalizeHiddenSidebarItems drops unknown ids", () => {
  assert.deepEqual(
    sidebarVisibility.normalizeHiddenSidebarItems(["logs", "cache", "bogus", "providers"]),
    ["providers", "logs"]
  );
});
