import { expect, test, type Page } from "@playwright/test";

async function openShows(page: Page) {
  await page.goto("/shows");
  // The page shell is server-rendered; allow the interactive HeroUI controls
  // to hydrate before exercising the user journey.
  await page.waitForTimeout(400);
}

test.describe("Shows UI", () => {
  test("lists the active tenant's portfolio", async ({ page }) => {
    await openShows(page);

    await expect(page.getByRole("heading", { name: "Shows in post" })).toBeVisible();
    await expect(page.getByText("Shows · Copperline Editorial")).toBeVisible();
    await expect(page.getByRole("link", { name: /Crossing Point/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Northern Static/ })).toBeVisible();
    await expect(page.getByText("City of Ash")).not.toBeVisible();
  });

  test("filters to a show and resets the selection when the tenant changes", async ({ page }) => {
    await openShows(page);

    await page.getByRole("button", { name: "All shows", exact: true }).click();
    await page.getByRole("button", { name: "Crossing Point", exact: true }).click();
    await expect(page.getByRole("button", { name: "Crossing Point", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Crossing Point/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Northern Static/ })).not.toBeVisible();

    await page.getByRole("button", { name: "Switch debug tenant" }).click();
    await page.getByRole("button", { name: "Lantern Post House admin access" }).click();
    await expect(page.getByText("Shows · Lantern Post House")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByRole("button", { name: "All shows", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "All shows", exact: true }).click();
    await expect(page.getByRole("button", { name: "City of Ash", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crossing Point", exact: true })).not.toBeVisible();
  });

  test("explains missing required fields before a show can be created", async ({ page }) => {
    await openShows(page);

    await page.getByRole("button", { name: "New show" }).click();
    await expect(page.getByRole("heading", { name: "Create show" })).toBeVisible();
    await page.getByRole("button", { name: "Create show", exact: true }).click();

    await expect(page.getByText("Show title is required.")).toBeVisible();
    await expect(page.getByText("Show code must be at least 2 characters.")).toBeVisible();
  });
});
