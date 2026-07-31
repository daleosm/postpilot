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

test.afterEach(async () => {
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
    const fields = builder.getByRole("combobox");
    await fields.nth(2).selectOption({ label: "Edit bay" });
    const previewResponse = page.waitForResponse((response) => response.url().includes("/v1/budget/estimate-preview") && response.request().method() === "POST");
    await builder.getByRole("button", { name: "Resolve rate", exact: true }).click();
    await expect((await previewResponse).json()).resolves.toMatchObject({ category: "Edit suite", rate_source: "master_rate_card" });
    await expect(builder.getByText("Master Rate Card", { exact: true })).toBeVisible();

    const saveResponse = page.waitForResponse((response) => response.url().endsWith("/v1/budget/lines") && response.request().method() === "POST");
    await builder.getByRole("button", { name: "Save estimate" }).click();

    await expect((await saveResponse).json()).resolves.toMatchObject({
      episode_id: TEST_EPISODE_ID,
      category: "Edit suite",
      planned_quantity: 1,
      planned_unit: "day",
      rate_source: "master_rate_card",
      estimated_amount: 896.8,
    });
    await expect(page.getByRole("heading", { name: "Estimate", exact: true })).toBeVisible();
  });

  test("expands seeded actuals to their booking and supplier-invoice sources, then explains variance", async ({ page }) => {
    await page.goto(`/budget?network=Slate%2B&show=Crossing%20Point&episode=${COPPERLINE_EPISODE_ID}`);

    const actuals = page.getByRole("heading", { name: "Actuals" }).locator("xpath=ancestor::section[1]");
    await actuals.locator("summary").first().click();
    await expect(actuals.getByText("Vendor invoice", { exact: true })).toBeVisible();
    await expect(actuals.getByText(/Supplier invoice received|External QC and finishing support/)).toBeVisible();

    const variance = page.getByRole("heading", { name: "Variance" }).locator("xpath=ancestor::section[1]");
    await variance.locator("summary").click();
    await expect(variance.getByText(/Current approved estimate/)).toBeVisible();
    await expect(variance.getByText(/Forecast remains within|Forecast is above/)).toBeVisible();
  });
});
