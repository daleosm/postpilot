import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const COPPERLINE_SEASON_ID = "26500000-0000-4000-8000-000000000001";
const ESTIMATE_EPISODE_ID = "fa200000-0000-4000-8000-000000000001";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for commercial UI tests.");
const sql = postgres(databaseUrl, { prepare: false });

test.afterEach(async () => {
  await sql`delete from budget_actual_allocations where budget_line_id in (select id from budget_lines where episode_id = ${ESTIMATE_EPISODE_ID})`;
  await sql`delete from budget_lines where episode_id = ${ESTIMATE_EPISODE_ID}`;
  await sql`delete from episodes where id = ${ESTIMATE_EPISODE_ID}`;
});

test.afterAll(async () => {
  await sql.end();
});

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

  test("builds an episode estimate through the commercial drill-down", async ({ page }) => {
    await sql`
      insert into episodes (id, organization_id, season_id, number, production_code, title, status, workflow_status, qc_status)
      values (${ESTIMATE_EPISODE_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${COPPERLINE_SEASON_ID}, 98, 'CP198', 'Commercial estimate test', 'development', 'not_started', 'not_started')
    `;
    await page.goto("/budget?network=Slate%2B&show=Crossing%20Point");
    const episode = page.locator(`a[href*="episode=${ESTIMATE_EPISODE_ID}"]`);
    await Promise.all([page.waitForURL(/episode=/), episode.click()]);
    await page.getByRole("button", { name: "Build estimate" }).click();
    const builder = page.getByRole("dialog", { name: "Build episode estimate" });
    // Select a real seeded service. The builder no longer mixes rooms and
    // services into one selector, and service labels are tenant-configurable.
    await builder.getByLabel("Estimate service").selectOption({ index: 1 });
    const unit = builder.getByLabel("Estimate billing unit");
    await expect(unit).toBeEnabled();
    await unit.selectOption({ label: "Hourly" });
    const body = await captureJsonWrite(page, "**/v1/budget/lines", { id: "fb000000-0000-4000-8000-000000000005" }, 201);

    await builder.getByRole("button", { name: "Save estimate" }).click();

    await expect.poll(body).toMatchObject({
      category: expect.any(String),
      planned_quantity: 1,
      planned_unit: "hour",
      rate_resource_type: "service",
      external_cost: false,
    });
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

  test("shows inherited rooms and saves a network room-price exception", async ({ page }) => {
    await page.route("**/v1/rate-cards/overrides?*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ overrides: {}, inherited: {} }) });
    });
    await page.route("**/v1/rate-cards/room-rates?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rooms: [{
            id: "room-rate-ui-001",
            name: "North Bay Grade",
            type: "Colour suite",
            own_rate: null,
            inherited_rate: {
              id: "master-room-rate-ui-001",
              category: "Colour suite",
              unit: "hour",
              rate: 240,
              internal_cost_rate: 115,
              currency: "GBP",
              source_scope: "master",
            },
          }],
        }),
      });
    });
    await page.goto("/budget");
    await Promise.all([
      page.waitForURL(/network=/),
      page.locator('a[href^="/budget?network="]').first().click(),
    ]);
    await page.getByRole("button", { name: "Manage rate card" }).click();
    const rooms = page.getByRole("heading", { name: "Room prices" }).locator("xpath=ancestor::section[1]");
    await expect(rooms.getByText("North Bay Grade", { exact: true })).toBeVisible();
    await rooms.getByRole("button", { name: "Override" }).click();
    const dialog = page.getByRole("dialog", { name: "Override room price" });
    await dialog.getByLabel("Client rate").fill("275");
    await dialog.getByLabel(/Internal cost rate/).fill("125");
    const body = await captureJsonWrite(page, "**/v1/rate-cards/overrides");

    await dialog.getByRole("button", { name: "Save room override" }).click();

    await expect.poll(body).toMatchObject({
      scope: "network",
      target_type: "room",
      room_id: "room-rate-ui-001",
      category: "Colour suite",
      unit: "hour",
      rate: 275,
      internal_cost_rate: 125,
    });
  });

  test("searches for and saves one explicit named artist rate", async ({ page }) => {
    await page.route("**/v1/rate-cards/artist-rates?*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ artist_rates: [] }) });
    });
    await page.route("**/v1/rate-cards/artists?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ people: [{ id: "artist-rate-ui-001", name: "Ari Taylor", role: "colourist" }] }),
      });
    });
    await page.goto("/budget");
    await page.getByRole("button", { name: "Manage rate card" }).click();
    await page.getByRole("button", { name: "Add artist rate" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add artist rate" });
    await dialog.getByLabel("Artist", { exact: true }).fill("Ari");
    await dialog.getByRole("button", { name: /Ari Taylor/ }).click();
    await dialog.getByLabel("Client rate").fill("185");
    await dialog.getByLabel(/Internal cost rate/).fill("96");
    const body = await captureJsonWrite(page, "**/v1/rate-cards/overrides");

    await dialog.getByRole("button", { name: "Add artist rate", exact: true }).click();

    await expect.poll(body).toMatchObject({
      scope: "master",
      target_type: "person",
      person_id: "artist-rate-ui-001",
      category: "Colourist",
      unit: "hour",
      rate: 185,
      internal_cost_rate: 96,
    });
  });

  test("removes a named artist exception while leaving the generic rate card intact", async ({ page }) => {
    let removed = false;
    await page.route("**/v1/rate-cards/artist-rates?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          artist_rates: removed
            ? []
            : [{
                id: "artist-rate-ui-remove-001",
                person: { id: "artist-ui-remove-001", name: "Ari Taylor", role: "colourist" },
                category: "Colourist",
                unit: "hour",
                client_rate: 185,
                internal_cost_rate: 96,
                currency: "USD",
              }],
        }),
      });
    });
    await page.route("**/v1/rate-cards/items/artist-rate-ui-remove-001", async (route) => {
      expect(route.request().method()).toBe("DELETE");
      removed = true;
      await route.fulfill({ status: 204 });
    });

    await page.goto("/budget");
    await page.getByRole("button", { name: "Manage rate card" }).click();
    const artistRate = page.getByText("Ari Taylor", { exact: true }).locator("xpath=ancestor::div[contains(@class, 'justify-between')][1]");
    await expect(artistRate).toBeVisible();
    await artistRate.getByRole("button", { name: "Remove" }).click();

    await expect(page.getByText("Ari Taylor", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No named artist rates on this card.")).toBeVisible();
  });
});
