import { expect, test, type Page } from "@playwright/test";
import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

async function openEpisodes(page: Page) {
  await page.goto("/episodes");
  await page.waitForTimeout(400);
}

test.describe("Episodes UI", () => {
  test("lists the active tenant's episode pipeline", async ({ page }) => {
    await openEpisodes(page);

    await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Westbound/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Night Ferry/ })).toBeVisible();
  });

  test("keeps the register header to its operational column labels only", async ({ page }) => {
    await openEpisodes(page);

    const register = page.getByLabel("Episodes");
    const header = register.locator(".episodes-register__header");
    await expect(header).toContainText("Episode");
    await expect(header).not.toContainText("Workflow");
    await expect(header.locator("a")).toHaveCount(0);
    await expect(register.getByText(/editor.?s cut/i)).toHaveCount(0);
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
