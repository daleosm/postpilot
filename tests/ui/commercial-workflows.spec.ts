import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.describe("Commercial UI workflows", () => {
  test("validates the essential vendor-PO fields before a draft is created", async ({ page }) => {
    await page.goto("/budget/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).click();
    await page.getByLabel("Authorised value (USD)").fill("100");
    await page.getByRole("button", { name: "Create draft PO" }).click();

    await expect(page.getByText("Select a vendor.")).toBeVisible();
    await expect(page.getByText("PO number is required.")).toBeVisible();
  });

  test("scopes vendor-PO episode choices when the show changes", async ({ page }) => {
    await page.goto("/budget/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).click();

    const show = page.getByLabel("Show");
    await show.selectOption({ index: 1 });
    const selectedShow = await show.inputValue();
    const episodeOptions = await page.getByLabel("Episode").locator("option").evaluateAll((options) => options.map((option) => ({ value: option.getAttribute("value"), text: option.textContent })));

    expect(selectedShow).not.toBe("");
    expect(episodeOptions.filter((option) => option.value)).not.toHaveLength(0);
  });

  test("prevents an expiry date earlier than the issue date in a vendor PO", async ({ page }) => {
    await page.goto("/budget/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).click();
    await page.getByLabel("Vendor").selectOption({ index: 1 });
    await page.getByLabel("PO number").fill("UI-DATE-VALIDATION");
    await page.getByLabel("Authorised value (USD)").fill("100");
    await page.getByLabel("Issue date").fill("2035-08-01");
    await page.getByLabel("Expiry date").fill("2035-07-01");
    await page.getByRole("button", { name: "Create draft PO" }).click();

    await expect(page.getByText("Expiry date cannot be before the issue date.")).toBeVisible();
  });

  test("keeps client POs as a separate billing authority workflow", async ({ page }) => {
    await page.goto("/budget/client-purchase-orders");
    await expect(page.getByText("Client PO register", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New client PO" }).click();

    await expect(page.getByRole("heading", { name: "New client PO" })).toBeVisible();
    await expect(page.getByLabel("Client account")).toBeVisible();
    await expect(page.getByLabel("Vendor")).toHaveCount(0);
    await expect(page.getByLabel("Client PO number")).toBeVisible();
  });

  test("validates required client-PO authority before saving", async ({ page }) => {
    await page.goto("/budget/client-purchase-orders");
    await page.getByRole("button", { name: "New client PO" }).click();
    await page.getByLabel("Authorised value (USD)").fill("100");
    await page.getByRole("button", { name: "Create draft client PO" }).click();

    await expect(page.getByText("Select a client account.")).toBeVisible();
    await expect(page.getByText("PO number is required.")).toBeVisible();
  });

  test("takes a producer through the budget drill-down rather than showing every cost at once", async ({ page }) => {
    await page.goto("/budget");
    await expect(page.getByRole("heading", { name: "Budget portfolio" })).toBeVisible();
    await expect(page.getByText("Start with the master rate card, then review networks, shows and episodes.")).toBeVisible();

    const firstNetwork = page.locator('a[href^="/budget?network="]').first();
    await expect(firstNetwork).toBeVisible();
    await firstNetwork.click();
    await expect(page.getByText("Show-level cost exposure and inherited network rates.")).toBeVisible();
  });

  test("validates a CRM contact before it can be attached to an account", async ({ page }) => {
    await page.goto("/crm");
    await page.getByRole("button", { name: "New contact" }).click();
    await page.getByRole("button", { name: "Create contact" }).click();

    await expect(page.getByText("Choose an account.")).toBeVisible();
    await page.getByLabel("Account").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Create contact" }).click();
    await expect(page.getByText("Enter a contact name.")).toBeVisible();
  });

  test("labels CRM account creation with finance and booking-clearance context", async ({ page }) => {
    await page.goto("/crm");
    await page.getByRole("button", { name: "New account" }).click();

    await expect(page.getByLabel("Account type")).toBeVisible();
    await expect(page.getByLabel("Payment terms (days)")).toBeVisible();
    await expect(page.getByLabel("Booking clearance")).toBeVisible();
    await expect(page.getByLabel("Finance email")).toBeVisible();
  });
});
