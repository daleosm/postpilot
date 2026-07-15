import { expect, test } from "@playwright/test";
import { useDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await useDebugSession(context, "user_copper_editor", COPPERLINE_ORGANIZATION_ID);
});

test.describe("My time UI", () => {
  test("gives an artist a personal time-confirmation workspace without the facility calendar", async ({ page }) => {
    await page.goto("/my-time");

    await expect(page.getByRole("heading", { name: "My time", exact: true })).toBeVisible();
    await expect(page.getByText("Confirm the actual time you worked.")).toBeVisible();
    await expect(page.getByRole("link", { name: "My time", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings", exact: true })).not.toBeVisible();
    await expect(page.getByText("CP101 editorial block", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirm actual time", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Confirm actual time", exact: true })).toBeVisible();
    await expect(page.getByLabel("Actual start")).toBeVisible();
    await expect(page.getByLabel("Actual end")).toBeVisible();
  });

  test("redirects an artist away from the scheduler-only facility calendar", async ({ page }) => {
    await page.goto("/bookings");
    await expect(page).toHaveURL(/\/my-time$/);
    await expect(page.getByRole("heading", { name: "My time", exact: true })).toBeVisible();
  });
});
