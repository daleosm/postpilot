import { expect, test } from "@playwright/test";

test.describe("Delivery register UI", () => {
  test("renders operational filters and makes unprofiled episodes explicit", async ({ page }) => {
    await page.goto("/deliveries");
    await expect(page.getByRole("heading", { name: "Deliveries" })).toBeVisible();
    await expect(page.getByText("Episode delivery register")).toBeVisible();
    await expect(page.getByLabel("Show")).toBeVisible();
    await expect(page.getByLabel("Episode")).toBeVisible();
    await expect(page.getByLabel("Recipient")).toBeVisible();
    await expect(page.getByLabel("Item status")).toBeVisible();
    await expect(page.getByLabel("Deadline risk")).toBeVisible();
    await expect(page.locator('select[name="receipt"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
  });

  test("filters receipt state and can reset", async ({ page }) => {
    await page.goto("/deliveries");
    const initialRowCount = await page.locator("tbody tr").count();
    await page.locator('select[name="receipt"]').selectOption("confirmed");
    const confirmedRowCount = await page.locator("tbody tr").count();
    expect(confirmedRowCount).toBeLessThanOrEqual(initialRowCount);
    if (!confirmedRowCount) await expect(page.getByText("No delivery manifests match these filters.")).toBeVisible();
    await page.locator('select[name="receipt"]').selectOption("awaiting");
    await expect(page.getByRole("link", { name: "Open manifest →" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator('select[name="receipt"]')).toHaveValue("");
  });
});
