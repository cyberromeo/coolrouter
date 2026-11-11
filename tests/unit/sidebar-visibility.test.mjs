import test from "node:test";
import assert from "node:assert/strict";

const sidebarVisibility = await import("../../src/shared/constants/sidebarVisibility.ts");

const ids = (sectionId) =>
  sidebarVisibility.SIDEBAR_SECTIONS.find((section) => section.id === sectionId)?.items.map(
    (item) => item.id
  );

test("primary sidebar is the simple three-step app", () => {
  assert.deepEqual(ids("primary"), ["home", "providers", "map", "connect"]);
});

test("power pages live under a collapsible Advanced section", () => {
  assert.deepEqual(ids("advanced"), ["combos", "api-manager", "playground", "analytics", "logs"]);
  const advanced = sidebarVisibility.SIDEBAR_SECTIONS.find((section) => section.id === "advanced");
  assert.equal(advanced.collapsible, true);
});

test("system sidebar has settings and docs", () => {
  assert.deepEqual(ids("system"), ["settings", "docs"]);
});

test("normalizeHiddenSidebarItems drops unknown ids", () => {
  assert.deepEqual(
    sidebarVisibility.normalizeHiddenSidebarItems(["logs", "cache", "bogus", "providers", "map"]),
    ["providers", "map", "logs"]
  );
});
