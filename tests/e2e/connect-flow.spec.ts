import { test, expect, type Page } from "@playwright/test";

// Connect apps: one click connects Claude Code, the card waits for the first
// message and turns Live when it arrives. The API is mocked, so no config files
// on this computer are touched.

async function gotoOrSkip(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/(login|dashboard)(\/.*)?$/);
  test.skip(page.url().includes("/login"), "Authentication enabled without a login fixture.");
}

async function installConnectMocks(page: Page) {
  const state = { connected: false, connectedAt: null as string | null, seen: false, posts: 0 };
  const status = () => ({
    connected: state.connected,
    needsUpdate: false,
    keyRevoked: false,
    installed: true,
    baseUrl: "http://127.0.0.1:20128",
    settingsPath: "C:\\Users\\me\\.claude\\settings.json",
    connectedAt: state.connectedAt,
    lastSeen: state.seen
      ? {
          timestamp: new Date(Date.now() + 1000).toISOString(),
          model: "deepseek/deepseek-chat",
          requestedModel: "claude-sonnet-5-5",
          provider: "deepseek",
          status: 200,
        }
      : null,
  });

  await page.route("**/api/model-map", (route) =>
    route.fulfill({
      json: {
        map: {
          rulesInstalled: true,
          conflicts: [],
          routes: {
            opus: { tier: "opus", models: ["openai/gpt-5"], servedBy: "opus" },
            sonnet: { tier: "sonnet", models: ["deepseek/deepseek-chat"], servedBy: "sonnet" },
            haiku: { tier: "haiku", models: [], servedBy: "sonnet" },
          },
        },
        models: [],
      },
    })
  );
  await page.route("**/api/cli-tools/claude-settings", async (route) => {
    if (route.request().method() === "POST") {
      state.posts += 1;
      state.connected = true;
      state.connectedAt = new Date().toISOString();
      return route.fulfill({
        json: { mode: "auto", settingsPath: "C:\\Users\\me\\.claude\\settings.json" },
      });
    }
    if (route.request().method() === "DELETE") {
      state.connected = false;
      return route.fulfill({ json: { disconnected: true } });
    }
    return route.fulfill({ json: status() });
  });
  await page.route("**/api/cli-tools/last-seen**", (route) =>
    route.fulfill({
      json: {
        connected: state.connected,
        connectedAt: state.connectedAt,
        lastSeen: status().lastSeen,
      },
    })
  );
  for (const path of ["claude-desktop", "codex-settings"]) {
    await page.route(`**/api/cli-tools/${path}`, (route) =>
      route.fulfill({
        json: { connected: false, installed: false, baseUrl: "http://127.0.0.1:20128" },
      })
    );
  }
  return state;
}

test.describe("Connect apps", () => {
  test("Claude Code connects in one click and turns Live on its first message", async ({
    page,
  }) => {
    const state = await installConnectMocks(page);
    await gotoOrSkip(page, "/dashboard/connect");

    const card = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Claude Code" }) });
    await expect(card.getByText("Not connected")).toBeVisible();
    await card.getByRole("button", { name: "Connect" }).click();

    await expect.poll(() => state.posts).toBe(1);
    await expect(card.getByText("Waiting for the first message")).toBeVisible();

    // Claude Code sends its first message.
    state.seen = true;
    // (The pill's icon is a ligature, so match the text loosely.)
    await expect(card.getByText(/answered by deepseek-chat/)).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText("Live");

    await card.getByRole("button", { name: "Disconnect" }).click();
    await expect(card.getByText("Not connected")).toBeVisible();
  });

  test("Show me how lists the steps and the /status check", async ({ page }) => {
    await installConnectMocks(page);
    await gotoOrSkip(page, "/dashboard/connect");

    const card = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Claude Code" }) });
    await card.getByRole("button", { name: "Show me how" }).click();
    await expect(card.getByText("Restart Claude Code")).toBeVisible();
    await expect(card.getByText("Anthropic base URL: http://127.0.0.1:20128")).toBeVisible();
  });
});
