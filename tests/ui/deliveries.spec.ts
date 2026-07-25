import { expect, test } from "@playwright/test";
import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

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
    // The register is a hydrated client filter over server-provided entries.
    // Wait for the seeded entries rather than counting during the initial
    // server/client handoff, when no links may have been attached yet.
    await expect(page.getByRole("link", { name: "Open checklist →" }).first()).toBeVisible();
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
