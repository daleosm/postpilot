import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonError, captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.describe("Settings and CRM form feedback", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("saves the post-house reporting currency through the settings form", async ({ page }) => {
    await page.goto("/settings/currency");
    await page.getByLabel("Currency").selectOption("EUR");
    const requestBody = await captureJsonWrite(page, "**/v1/settings/currency");

    await page.getByRole("button", { name: "Save currency" }).click();

    await expect.poll(requestBody).toMatchObject({ currency: "EUR" });
    await expect(page.getByText("Saved. All commercial records now use this reporting currency.")).toBeVisible();
  });

  test("shows an actionable error when a catering settings save is rejected", async ({ page }) => {
    await page.goto("/settings/catering");
    await page.getByLabel("Markup percentage").fill("12.5");
    await captureJsonError(page, "**/v1/settings/catering", "Only commercial managers can change catering markup.", 403);

    await page.getByRole("button", { name: "Save markup" }).click();

    await expect(page.getByText("Only commercial managers can change catering markup.")).toBeVisible();
  });

  test("reveals and saves optional invoice-tax details", async ({ page }) => {
    await page.goto("/settings/invoicing");
    await page.getByText("Add VAT / sales tax to new invoices", { exact: true }).click();
    await page.getByLabel("Tax label").fill("VAT");
    await page.getByLabel("Tax registration number").fill("GB123456789");
    await page.getByLabel("Tax rate (%)").fill("20");
    const requestBody = await captureJsonWrite(page, "**/v1/settings/invoicing");

    await page.getByRole("button", { name: "Save invoicing settings" }).click();

    await expect.poll(requestBody).toMatchObject({ tax_enabled: true, tax_name: "VAT", tax_registration_number: "GB123456789", tax_rate_percent: "20" });
    await expect(page.getByRole("status")).toContainText("Invoice settings saved");
  });

  test("updates account context from the CRM account view", async ({ page }) => {
    await page.goto("/crm");
    await page.locator('a[href^="/crm/accounts/"]').first().click();
    const requestBody = await captureJsonWrite(page, "**/v1/crm/companies/*");
    await page.getByRole("button", { name: "Update account" }).click();
    await page.getByLabel("Next action").fill("Confirm final delivery route.");
    await page.getByLabel("Due date").fill("2034-08-20");

    await page.getByRole("button", { name: "Save account" }).click();

    await expect.poll(requestBody).toMatchObject({ next_action: "Confirm final delivery route.", next_action_due_at: "2034-08-20" });
  });

  test("validates a new user before sending the tenant-scoped access request", async ({ page }) => {
    await page.goto("/settings/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("Enter the user's name.")).toBeVisible();
    await expect(page.getByText("Enter a valid work email.")).toBeVisible();

    await page.getByLabel("Name").fill("UI Access Test");
    await page.getByLabel("Work email").fill("ui-access@example.test");
    const requestBody = await captureJsonWrite(page, "**/v1/settings/users", { user_id: "f9000000-0000-4000-8000-000000000001" }, 201);
    await page.getByRole("button", { name: "Create user" }).click();

    await expect.poll(requestBody).toMatchObject({ name: "UI Access Test", email: "ui-access@example.test" });
    await expect(page.getByRole("status")).toContainText("User access created");
  });
});

test.describe("Debug context, error and responsive safeguards", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("shows the seeded debug identities in a scrollable identity switcher", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Switch debug user" }).click();

    await expect(page.getByText("Debug user / role", { exact: true })).toBeVisible();
    await expect(page.getByText("Mori Vale", { exact: true })).toBeVisible();
    await expect(page.locator("div.max-h-\\[calc\\(100vh-9rem\\)\\]")).toHaveCSS("overflow-y", "auto");
  });

  test("keeps tenant and debug controls usable at a tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Switch debug tenant" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch debug user" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });

  test("renders a clear recovery route for unavailable or inaccessible records", async ({ page }) => {
    await page.goto("/episodes/00000000-0000-4000-8000-000000000000");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to dashboard" })).toBeVisible();
  });

  test("keeps the legacy assets route from exposing a dead module", async ({ page }) => {
    await page.goto("/assets");

    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  });
});
