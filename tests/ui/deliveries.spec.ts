import { expect, test } from "@playwright/test";

test.describe("Delivery register UI", () => {
  test("renders a compact operational register and makes unprofiled episodes explicit", async ({ page }) => {
    await page.goto("/deliveries");
    await expect(page.getByRole("heading", { name: "Deliveries" })).toBeVisible();
    await expect(page.getByText("Episode delivery register")).toBeVisible();
    await expect(page.getByLabel("Show")).toBeVisible();
    await expect(page.getByLabel("Delivery state")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
  });

  test("filters simple delivery state and can reset", async ({ page }) => {
    await page.goto("/deliveries");
    const initialRowCount = await page.getByRole("link", { name: "Open checklist →" }).count();
    await page.locator('select[name="state"]').selectOption("accepted");
    const acceptedRowCount = await page.getByRole("link", { name: "Open checklist →" }).count();
    expect(acceptedRowCount).toBeLessThanOrEqual(initialRowCount);
    if (!acceptedRowCount) await expect(page.getByText("No episodes match these filters.")).toBeVisible();
    await page.locator('select[name="state"]').selectOption("in_progress");
    await expect(page.getByRole("link", { name: "Open checklist →" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator('select[name="state"]')).toHaveValue("");
  });
});
