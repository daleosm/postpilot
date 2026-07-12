import { expect, test, type Page } from "@playwright/test";

async function openReview(page: Page) {
  await page.goto("/review");
  await page.waitForTimeout(400);
}

test.describe("Review usability", () => {
  test("shows the signer-specific workflow approval inbox", async ({ page }) => {
    await openReview(page);

    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Awaiting my sign-off" })).toBeVisible();
    await expect(page.getByText("Current workflow stages that have reached your configured sign-off role.")).toBeVisible();
  });

  test("uses workflow-only sign-off language", async ({ page }) => {
    await openReview(page);

    await expect(page.getByText("Workflow stages awaiting the next configured sign-off.")).toBeVisible();
  });

  test("does not expose retired media-review controls", async ({ page }) => {
    await openReview(page);

    await expect(page.getByRole("button", { name: "Register cut", exact: true })).not.toBeVisible();
    await expect(page.getByText("Version history")).not.toBeVisible();
  });
});
