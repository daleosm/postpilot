import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { establishDebugSession } from "../fixtures/debug-session";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for budget operational UI tests.");
const sql = postgres(databaseUrl, { prepare: false });

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const COPPERLINE_SEASON_ID = "26500000-0000-4000-8000-000000000001";
const COPPERLINE_EPISODE_ID = "27500000-0000-4000-8000-000000000001";
const TEST_EPISODE_ID = "fa100000-0000-4000-8000-000000000001";
const UNRECONCILED_INVOICE_ID = "fa100000-0000-4000-8000-000000000002";

test.afterEach(async () => {
  await sql`delete from client_invoice_items where client_invoice_id = ${UNRECONCILED_INVOICE_ID}`;
  await sql`delete from client_invoices where id = ${UNRECONCILED_INVOICE_ID}`;
  await sql`delete from budget_actual_allocations where budget_line_id in (select id from budget_lines where episode_id = ${TEST_EPISODE_ID})`;
  await sql`delete from budget_lines where episode_id = ${TEST_EPISODE_ID}`;
  await sql`delete from episodes where id = ${TEST_EPISODE_ID}`;
});

test.afterAll(async () => {
  await sql.end();
});

test.describe("Episode estimate to actual UI", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("builds an editable episode estimate from the master rate card", async ({ page }) => {
    await sql`
      insert into episodes (id, organization_id, season_id, number, production_code, title, status, workflow_status, qc_status)
      values (${TEST_EPISODE_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${COPPERLINE_SEASON_ID}, 99, 'CP199', 'Rate card estimate test', 'development', 'not_started', 'not_started')
    `;

    await page.goto(`/budget?network=Slate%2B&show=Crossing%20Point&episode=${TEST_EPISODE_ID}`);
    await page.getByRole("button", { name: "Build estimate" }).click();
    const builder = page.getByRole("heading", { name: "Build estimate" }).locator("xpath=ancestor::section[1]");
    // The builder now has separate item-type and resource controls. Select a
    // seeded master-card service rather than relying on a retired combined
    // "Edit bay" option label.
    await builder.getByLabel("Estimate service").selectOption({ index: 1 });
    const previewResponse = page.waitForResponse((response) => response.url().includes("/v1/budget/estimate-preview") && response.request().method() === "POST");
    await builder.getByRole("button", { name: "Resolve rate", exact: true }).click();
    const preview = await (await previewResponse).json() as { category: string; unit: string; estimate: number; rate_source: string };
    expect(preview).toMatchObject({ category: expect.any(String), rate_source: "master_rate_card" });
    await expect(builder.getByText("Master Rate Card", { exact: true })).toBeVisible();

    const saveResponse = page.waitForResponse((response) => response.url().endsWith("/v1/budget/lines") && response.request().method() === "POST");
    await builder.getByRole("button", { name: "Save estimate" }).click();

    await expect((await saveResponse).json()).resolves.toMatchObject({
      episode_id: TEST_EPISODE_ID,
      category: preview.category,
      planned_quantity: 1,
      planned_unit: preview.unit,
      rate_source: "master_rate_card",
      estimated_amount: preview.estimate,
    });
    await expect(page.getByRole("heading", { name: "Estimate", exact: true })).toBeVisible();
  });

  test("expands seeded actuals to their booking and supplier-invoice sources, then explains variance", async ({ page }) => {
    await page.goto(`/budget?network=Slate%2B&show=Crossing%20Point&episode=${COPPERLINE_EPISODE_ID}`);
    await expect(page.getByRole("heading", { name: /Budget · E\d{2} .+/ })).toBeVisible();

    const actuals = page.getByRole("heading", { name: "Actuals" }).locator("xpath=ancestor::section[1]");
    await actuals.locator("summary").first().click();
    await expect(actuals.getByText("Vendor invoice", { exact: true })).toBeVisible();
    await expect(actuals.getByText(/Supplier invoice received|External QC and finishing support/)).toBeVisible();

    const variance = page.getByRole("heading", { name: "Variance" }).locator("xpath=ancestor::section[1]");
    await variance.locator("summary").click();
    await expect(variance.getByText(/Current approved estimate/)).toBeVisible();
    await expect(variance.getByText(/Forecast remains within|Forecast is above/)).toBeVisible();
  });

  test("renders the API actual total, traces its sources, and locks an unreconciled invoice", async ({ page }) => {
    const estimateResponse = await page.request.get(`/v1/budget/episodes/${COPPERLINE_EPISODE_ID}/estimate-overview`);
    expect(estimateResponse.ok()).toBeTruthy();
    const estimatePayload = await estimateResponse.json() as {
      estimate: { actual: number; currency: string };
    };
    const estimate = estimatePayload.estimate;
    const expectedActual = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: estimate.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(estimate.actual);

    await sql`
      insert into client_invoices (
        id, organization_id, sequence, invoice_number, show_id, episode_id, status,
        invoice_date, due_date, currency, subtotal_amount, tax_enabled, tax_name,
        tax_rate_percent, tax_amount, total_amount, issuer_name, client_name
      )
      select
        ${UNRECONCILED_INVOICE_ID}, episodes.organization_id, 999999, 'UI-RECONCILIATION-LOCK', seasons.show_id, episodes.id, 'issued',
        '2026-07-31', '2026-08-30', 'GBP', 19.99, false, 'VAT',
        0, 0, 19.99, 'PostPilot Test Facility', 'Unreconciled client'
      from episodes
      inner join seasons on seasons.id = episodes.season_id
      where episodes.id = ${COPPERLINE_EPISODE_ID}
    `;

    await page.goto(`/budget?network=Slate%2B&show=Crossing%20Point&episode=${COPPERLINE_EPISODE_ID}`);
    const actuals = page.getByRole("heading", { name: "Actuals" }).locator("xpath=ancestor::section[1]");
    await expect(actuals.getByText(expectedActual, { exact: true })).toBeVisible();
    await actuals.locator("summary").first().click();
    await expect(actuals.getByText("Budget item", { exact: true })).toBeVisible();
    await expect(actuals.getByText("Vendor invoice", { exact: true })).toBeVisible();

    await expect(page.getByText("UI-RECONCILIATION-LOCK", { exact: true })).toBeVisible();
    await expect(page.getByText(/PDF export blocked/)).toBeVisible();
    await expect(page.getByText("Export locked", { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/v1/billing/invoices/${UNRECONCILED_INVOICE_ID}/export"]`)).toHaveCount(0);
  });
});
