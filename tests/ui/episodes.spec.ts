import { expect, test, type Page } from "@playwright/test";

async function openEpisodes(page: Page) {
  await page.goto("/episodes");
  await page.waitForTimeout(400);
}

test.describe("Episodes UI", () => {
  test("lists the active tenant's episode pipeline", async ({ page }) => {
    await openEpisodes(page);

    await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();
    await expect(page.getByText("16 episodes", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Westbound/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Night Ferry/ })).toBeVisible();
  });

  test("filters episodes by show and workflow using labelled controls", async ({ page }) => {
    await openEpisodes(page);

    await page.getByLabel("Show").selectOption({ label: "Crossing Point" });
    await expect(page.getByText("4 episodes", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Westbound/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Relay/ })).not.toBeVisible();

    await page.getByLabel("Status").selectOption("locked");
    await expect(page.getByText("1 episodes", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Night Ferry/ })).toBeVisible();
  });

  test("explains required fields before creating an episode", async ({ page }) => {
    await openEpisodes(page);

    await page.getByRole("button", { name: "New episode" }).click();
    await expect(page.getByRole("heading", { name: "New episode" })).toBeVisible();
    await page.getByRole("button", { name: "Create episode", exact: true }).click();

    await expect(page.getByText("Select a season.")).toBeVisible();
    await expect(page.getByText("Enter an episode title.")).toBeVisible();
  });
});
