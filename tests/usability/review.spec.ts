import { expect, test, type Page } from "@playwright/test";

async function openReview(page: Page) {
  await page.goto("/review");
  await page.waitForTimeout(400);
}

test.describe("Review usability", () => {
  test("shows the signer-specific workflow approval inbox", async ({ page }) => {
    await openReview(page);

    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "My approval queue" })).toBeVisible();
    await expect(page.getByText("Only approval gates assigned to you appear here.")).toBeVisible();
  });

  test("explains when the current signer has no approvals waiting", async ({ page }) => {
    await openReview(page);

    await expect(page.getByText("No workflow approvals are waiting for your sign-off.")).toBeVisible();
  });

  test("does not expose the retired review-cut registration queue", async ({ page }) => {
    await openReview(page);

    await expect(page.getByRole("button", { name: "Register cut", exact: true })).not.toBeVisible();
    await expect(page.getByRole("link", { name: /producer review/ })).not.toBeVisible();
  });
});
