import { expect, test } from "@playwright/test";
import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.describe("Delivery profile settings UI", () => {
  test("lets an authorised post house configure a reusable delivery profile", async ({ page }) => {
    await page.goto("/settings/delivery-profiles");
    await expect(page.getByRole("heading", { name: "Delivery profiles", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "New delivery profile" }).click();
    await expect(page.getByRole("heading", { name: "New delivery profile" })).toBeVisible();
    await expect(page.getByLabel("Profile name")).toBeVisible();
    await expect(page.getByLabel("Client / network account")).toBeVisible();
    await expect(page.getByLabel("Show (optional)")).toBeVisible();
    await expect(page.getByLabel("Specification link (optional)")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "New delivery profile" })).not.toBeVisible();
  });

  test("shows client-side validation before an empty profile is submitted", async ({ page }) => {
    await page.goto("/settings/delivery-profiles");
    await page.getByRole("button", { name: "New delivery profile" }).click();
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByText("Profile name is required.")).toBeVisible();
  });
});
