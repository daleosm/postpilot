import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.describe("Commercial completion journeys", () => {
  test("creates a scoped vendor PO draft with its authority and supplier details", async ({ page }) => {
    await page.goto("/budget/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).click();
    const form = page.getByRole("heading", { name: "New purchase order" }).locator("xpath=ancestor::form[1]");
    await form.getByLabel("Vendor").selectOption({ index: 1 });
    await form.getByLabel("PO number").fill("UI-VENDOR-PO-104");
    await form.getByLabel(/Authorised value/).fill("2400");
    await form.getByLabel("Issue date").fill("2034-09-01");
    await form.getByLabel("Expiry date").fill("2034-12-31");
    await form.getByLabel("Notes").fill("Approved external mix revision.");
    const body = await captureJsonWrite(page, "**/v1/purchase-orders", { id: "fb000000-0000-4000-8000-000000000001" }, 201);

    await form.getByRole("button", { name: "Create draft PO" }).click();

    await expect.poll(body).toMatchObject({ po_number: "UI-VENDOR-PO-104", approved_amount: 2400, notes: "Approved external mix revision.", vendor_company_id: expect.any(String) });
  });

  test("creates a client billing-authority PO without using supplier controls", async ({ page }) => {
    await page.goto("/budget/client-purchase-orders");
    await page.getByRole("button", { name: "New client PO" }).click();
    const form = page.getByRole("heading", { name: "New client PO" }).locator("xpath=ancestor::form[1]");
    await form.getByLabel("Client account").selectOption({ index: 1 });
    await form.getByLabel("Client PO number").fill("UI-CLIENT-PO-104");
    await form.getByLabel(/Authorised value/).fill("3600");
    await form.getByLabel("Issue date").fill("2034-09-01");
    await form.getByLabel("Notes").fill("Network-approved additional online work.");
    await expect(form.getByLabel("Vendor")).toHaveCount(0);
    const body = await captureJsonWrite(page, "**/v1/client-purchase-orders", { id: "fb000000-0000-4000-8000-000000000002" }, 201);

    await form.getByRole("button", { name: "Create draft client PO" }).click();

    await expect.poll(body).toMatchObject({ po_number: "UI-CLIENT-PO-104", approved_amount: 3600, notes: "Network-approved additional online work.", client_company_id: expect.any(String) });
  });

  test("creates a CRM account and a purpose-specific contact from the directory", async ({ page }) => {
    await page.goto("/crm");
    await page.getByRole("button", { name: "New account" }).click();
    const account = page.locator("form").filter({ has: page.getByLabel("Account name") });
    await account.getByLabel("Account name").fill("UI Test Network");
    await account.getByLabel("Account type").selectOption("network");
    await account.getByLabel("Payment terms (days)").fill("30");
    const accountBody = await captureJsonWrite(page, "**/v1/crm/companies", { id: "fb000000-0000-4000-8000-000000000003" }, 201);
    await account.getByRole("button", { name: "Create account" }).click();
    await expect.poll(accountBody).toMatchObject({ name: "UI Test Network", type: "network", payment_terms_days: 30 });

    await page.getByRole("button", { name: "New contact" }).click();
    const contact = page.locator("form").filter({ has: page.getByLabel("Contact name") });
    await contact.getByLabel("Account").selectOption({ index: 1 });
    await contact.getByLabel("Contact name").fill("UI Delivery Manager");
    await contact.getByLabel("Operational purpose").selectOption("technical_delivery");
    await contact.getByLabel("Email").fill("delivery@example.test");
    const contactBody = await captureJsonWrite(page, "**/v1/crm/contacts", { id: "fb000000-0000-4000-8000-000000000004" }, 201);
    await contact.getByRole("button", { name: "Create contact" }).click();
    await expect.poll(contactBody).toMatchObject({ name: "UI Delivery Manager", contact_type: "technical_delivery", email: "delivery@example.test", company_id: expect.any(String) });
  });

  test("filters the account directory and shows an operational empty state", async ({ page }) => {
    await page.goto("/crm");
    const search = page.getByPlaceholder("Search accounts, owners, actions…");
    await search.fill("definitely-not-a-postpilot-account");
    await expect(page.getByText("No accounts match this view.")).toBeVisible();
    await search.fill("");
    await page.getByRole("button", { name: "Vendor", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  });

  test("adds an episode budget line through the commercial drill-down", async ({ page }) => {
    await page.goto("/budget");
    const network = page.locator('a[href^="/budget?network="]').first();
    await Promise.all([page.waitForURL(/network=/), network.click()]);
    const show = page.locator('a[href^="/budget?network="][href*="show="]').first();
    await Promise.all([page.waitForURL(/show=/), show.click()]);
    const episode = page.locator('a[href*="&episode="]').first();
    await Promise.all([page.waitForURL(/episode=/), episode.click()]);
    await page.getByRole("button", { name: "Add episode budget" }).click();
    const form = page.getByRole("heading", { name: "Add episode budget line" }).locator("xpath=ancestor::form[1]");
    await form.getByLabel("Category").selectOption("sound");
    await form.getByLabel("Description").fill("UI final mix stem delivery");
    await form.getByLabel(/Estimated cost/).fill("840");
    await form.getByLabel(/Actual cost/).fill("420");
    const body = await captureJsonWrite(page, "**/v1/budget/lines", { id: "fb000000-0000-4000-8000-000000000005" }, 201);

    await form.getByRole("button", { name: "Save line" }).click();

    await expect.poll(body).toMatchObject({ category: "sound", description: "UI final mix stem delivery", budgeted_amount: 840, actual_amount: 420, external_cost: false });
  });

  test("sets a network service-price exception without changing the master rate", async ({ page }) => {
    await page.goto("/budget");
    await page.locator('a[href^="/budget?network="]').first().click();
    await page.waitForTimeout(300);
    await page.route("**/v1/rate-cards/overrides?*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ overrides: {}, inherited: {} }) });
    });
    await page.getByRole("button", { name: "Manage rate card" }).click();
    await expect(page.getByRole("heading", { name: /rate card$/i })).toBeVisible();
    await page.getByRole("button", { name: "Override" }).first().click();
    await page.getByRole("spinbutton", { name: "Rate", exact: true }).fill("712");
    const body = await captureJsonWrite(page, "**/v1/rate-cards/overrides");

    await page.getByRole("button", { name: "Save override" }).click();

    await expect.poll(body).toMatchObject({ scope: "network", network: expect.any(String), show_id: null, episode_id: null, rate: 712 });
  });
});
