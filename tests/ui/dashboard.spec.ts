import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.describe("Dashboard command center", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("puts today’s operational context and attention signals above generic totals", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Today in post" })).toBeVisible();
    await expect(page.getByLabel("Today’s operational signals")).toBeVisible();
    await expect(page.getByRole("link", { name: /Active shows/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /QC failures/i })).toBeVisible();
  });

  test("combines live production attention and capacity into one command-center view", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Operational timeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Capacity this week" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Budget health" })).toBeVisible();
    await expect(page.locator(".dashboard-timeline__item, .dashboard-timeline .text-center").first()).toBeVisible();
  });
});
