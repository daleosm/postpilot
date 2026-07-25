import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

async function signInAs(context: Parameters<typeof establishDebugSession>[0], userId: string) {
  await establishDebugSession(context, userId, COPPERLINE_ORGANIZATION_ID);
}

test.describe("Workspace access and responsive UI", () => {
  test("gives the administrator the complete operational navigation", async ({ context, page }) => {
    await signInAs(context, "user_maya");
    await page.goto("/");

    for (const item of ["Dashboard", "Shows", "Episodes", "Bookings", "My time", "Catering", "Runner desk", "Budget", "Deliveries", "Clients & vendors", "Team", "Approvals"]) {
      await expect(page.getByRole("navigation").getByRole("link", { name: item, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  });

  test("keeps an assigned editor out of commercial and facility-management areas", async ({ context, page }) => {
    await signInAs(context, "user_copper_editor");
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Episodes", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "My time", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Budget", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Clients & vendors", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Runner desk", exact: true })).toHaveCount(0);
  });

  test("keeps finance focused on commercial records", async ({ context, page }) => {
    await signInAs(context, "user_copper_finance");
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Budget", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clients & vendors", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Runner desk", exact: true })).toHaveCount(0);
  });

  test("keeps the runner desk and catering tools available only to the runner", async ({ context, page }) => {
    await signInAs(context, "user_copper_runner");
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Catering", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Runner desk", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Budget", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Shows", exact: true })).toHaveCount(0);
  });

  test("does not expose the internal navigation to a client account", async ({ context, page }) => {
    await signInAs(context, "user_copper_client");
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Budget", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Bookings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Catering", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Clients & vendors", exact: true })).toHaveCount(0);
  });

  for (const route of ["/episodes", "/bookings", "/deliveries", "/budget/purchase-orders"]) {
    test(`keeps ${route} usable without horizontal page overflow on a phone`, async ({ context, page }) => {
      await signInAs(context, "user_maya");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);

      await expect(page.locator("main")).toBeVisible();
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    });
  }
});
