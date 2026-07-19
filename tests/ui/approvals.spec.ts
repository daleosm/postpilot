import { expect, test, type Page } from "@playwright/test";

async function openReview(page: Page) {
  await page.goto("/review");
  await page.waitForTimeout(400);
}

test.describe("Approvals UI", () => {
  test("shows the signer-specific workflow approval inbox", async ({ page }) => {
    await openReview(page);

    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Awaiting my sign-off" })).toBeVisible();
    await expect(page.getByText("Current workflow stages where you are the named sign-off person.")).toBeVisible();
  });

  test("explains the workflow and assigned-work approval inbox", async ({ page }) => {
    await openReview(page);

    await expect(page.getByText("Workflow gates awaiting sign-off and practical post work assigned to you.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "My assigned work" })).toBeVisible();
  });

  test("does not expose retired media-review controls", async ({ page }) => {
    await openReview(page);

    await expect(page.getByRole("button", { name: "Register cut", exact: true })).not.toBeVisible();
    await expect(page.getByText("Version history")).not.toBeVisible();
  });
});
