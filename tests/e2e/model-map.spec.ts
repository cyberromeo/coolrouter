import { test, expect, type Page } from "@playwright/test";

// The model map, list view: three routes named after Claude's tiers, each an
// ordered list of models. The API is mocked, so no real routes are changed.

const MODELS = [
  {
    id: "openai/gpt-5",
    provider: "openai",
    modelId: "gpt-5",
    name: "GPT 5",
    providerName: "OpenAI",
    contextLength: 400000,
    toolCalling: true,
  },
  {
    id: "deepseek/deepseek-chat",
    provider: "deepseek",
    modelId: "deepseek-chat",
    name: "Deepseek Chat",
    providerName: "DeepSeek",
    contextLength: 128000,
    toolCalling: true,
  },
  {
    id: "gemini/gemini-2.5-flash",
    provider: "gemini",
    modelId: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    providerName: "Gemini",
    contextLength: 1048576,
    toolCalling: true,
  },
];

function mapWith(routes: Record<string, string[]>) {
  const tiers = ["opus", "sonnet", "haiku"];
  return {
    rulesInstalled: true,
    conflicts: [],
    routes: Object.fromEntries(
      tiers.map((tier) => [
        tier,
        { tier, comboId: `c-${tier}`, comboName: tier, models: routes[tier] ?? [], servedBy: tier },
      ])
    ),
  };
}

async function installModelMapMock(page: Page) {
  const saved: Array<{ tier: string; models: string[] }> = [];
  let routes: Record<string, string[]> = {
    opus: ["openai/gpt-5", "deepseek/deepseek-chat"],
    sonnet: ["deepseek/deepseek-chat"],
    haiku: ["gemini/gemini-2.5-flash"],
  };
  await page.route("**/api/model-map", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saved.push(body);
      routes = { ...routes, [body.tier]: body.models };
      return route.fulfill({ json: { map: mapWith(routes) } });
    }
    return route.fulfill({ json: { map: mapWith(routes), models: MODELS } });
  });
  return saved;
}

async function gotoOrSkip(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/(login|dashboard)(\/.*)?$/);
  test.skip(page.url().includes("/login"), "Authentication enabled without a login fixture.");
}

test.describe("Model map", () => {
  test("list view shows the three routes and saves a reordered route", async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem("coolrouter:model-map-view", "list")
    );
    const saved = await installModelMapMock(page);
    await gotoOrSkip(page, "/dashboard/map");

    for (const name of ["Opus", "Sonnet", "Haiku"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    const opus = page.getByRole("region", { name: "Opus" });
    await expect(opus.getByText("GPT 5")).toBeVisible();

    // Move GPT 5 after Deepseek Chat on the Opus route.
    await opus.getByRole("button", { name: "Try later" }).first().click();
    await expect.poll(() => saved.length).toBeGreaterThan(0);
    expect(saved.at(-1)).toEqual({
      tier: "opus",
      models: ["deepseek/deepseek-chat", "openai/gpt-5"],
    });
    await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
  });

  test("adding a model from the picker appends it to the route", async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem("coolrouter:model-map-view", "list")
    );
    const saved = await installModelMapMock(page);
    await gotoOrSkip(page, "/dashboard/map");

    const haiku = page.getByRole("region", { name: "Haiku" });
    await haiku.getByRole("button", { name: "Add model" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Search models or providers").fill("deepseek");
    await dialog.getByRole("button", { name: /Deepseek Chat/ }).click();

    await expect.poll(() => saved.length).toBeGreaterThan(0);
    expect(saved.at(-1)).toEqual({
      tier: "haiku",
      models: ["gemini/gemini-2.5-flash", "deepseek/deepseek-chat"],
    });
  });
});
