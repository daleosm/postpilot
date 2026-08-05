import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for delivery and commercial UI tests.");
const sql = postgres(databaseUrl, { prepare: false });

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const MANIFEST_EPISODE_ID = "27500000-0000-4000-8000-000000000001";
const UNPROFILED_EPISODE_ID = "27500000-0000-4000-8000-000000000005";
const TEST_DELIVERY_ITEM_ID = "f8000000-0000-4000-8000-000000000001";
const TEST_DELIVERY_ITEM_LABEL = "UI dispatchable metadata package";

test.afterEach(async () => {
  await sql`delete from episode_delivery_items where id = ${TEST_DELIVERY_ITEM_ID}`;
});

test.afterAll(async () => {
  await sql.end();
});

test.describe("Delivery manifest operations", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("applies a selected delivery profile to an unconfigured episode with an audit reason", async ({ page }) => {
    await page.goto(`/episodes/${UNPROFILED_EPISODE_ID}`);
    await page.getByRole("button", { name: "Delivery manifest", exact: true }).click();
    await expect(page.getByText("Set up the delivery checklist")).toBeVisible();
    await page.getByLabel("Profile application reason").fill("Network delivery requirements confirmed.");
    const requestBody = await captureJsonWrite(page, `**/v1/episodes/${UNPROFILED_EPISODE_ID}/delivery-manifest/apply`, { id: "f8000000-0000-4000-8000-000000000099" }, 201);

    await page.getByRole("button", { name: "Apply profile" }).click();

    await expect.poll(requestBody).toMatchObject({ reason: "Network delivery requirements confirmed." });
  });

  test("requires a dispatch note and sends an external reference for a delivery item", async ({ page }) => {
    const [manifest] = await sql<{ id: string }[]>`
      select id from episode_delivery_manifests
      where organization_id = ${COPPERLINE_ORGANIZATION_ID} and episode_id = ${MANIFEST_EPISODE_ID}
      limit 1
    `;
    if (!manifest) throw new Error("Copperline manifest fixture is missing.");
    await sql`
      insert into episode_delivery_items (
        id, organization_id, episode_delivery_manifest_id, episode_id, component_type, label,
        required, requires_external_recipient, qc_required, status, is_externally_shared, qc_result, position
      ) values (
        ${TEST_DELIVERY_ITEM_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${manifest.id}, ${MANIFEST_EPISODE_ID}, 'metadata_sheet', ${TEST_DELIVERY_ITEM_LABEL},
        false, false, false, 'ready_for_qc', false, 'not_required', 99
      )
    `;
    await page.goto(`/episodes/${MANIFEST_EPISODE_ID}`);
    await page.getByRole("button", { name: "Delivery manifest", exact: true }).click();
    await expect(page.getByText(TEST_DELIVERY_ITEM_LABEL, { exact: true })).toBeVisible();
    const transitionForm = page.locator(`input[id="${TEST_DELIVERY_ITEM_ID}-reason"]`).locator("xpath=ancestor::form[1]");
    await transitionForm.getByLabel("Operational note").fill("Placed in the network delivery portal.");
    await transitionForm.getByLabel("External reference").fill("DEL-UI-104");
    const requestBody = await captureJsonWrite(page, `**/v1/episodes/${MANIFEST_EPISODE_ID}/delivery-items/${TEST_DELIVERY_ITEM_ID}/transition`);

    await transitionForm.getByRole("button", { name: "Dispatch" }).click();

    await expect.poll(requestBody).toMatchObject({
      status: "dispatched",
      reason: "Placed in the network delivery portal.",
      external_reference: "DEL-UI-104",
    });
  });

  test("adds a future delivery-profile requirement without changing an episode snapshot", async ({ page }) => {
    await page.goto("/settings/delivery-profiles");
    await page.getByRole("button", { name: "Add requirement" }).first().click();
    await page.getByLabel("Display label").fill("UI regional metadata sheet");
    await page.getByLabel("Format / specification").fill("Network metadata XML v2");
    const requestBody = await captureJsonWrite(page, /\/v1\/delivery-profiles\/[^/]+\/items$/u, { id: "f8000000-0000-4000-8000-000000000100" }, 201);

    await page.getByRole("button", { name: "Add requirement" }).last().click();

    await expect.poll(requestBody).toMatchObject({
      label: "UI regional metadata sheet",
      format_specification: "Network metadata XML v2",
    });
  });
});

test.describe("Commercial register actions", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("records a vendor actual through the PO detail form with a supplier reference", async ({ page }) => {
    await page.goto("/budget/purchase-orders");
    await page.locator('a[href^="/budget/purchase-orders/"]').first().click();
    await page.getByRole("button", { name: "Record supplier actual" }).click();
    await page.getByLabel("External budget item").selectOption({ index: 1 });
    await page.getByLabel("Supplier invoice / reference").fill("UI-VENDOR-104");
    await page.getByLabel("Invoice date").fill("2034-08-15");
    await page.getByLabel("Description").fill("UI colour correction invoice");
    await page.getByLabel(/Actual supplier cost/).fill("850");
    const requestBody = await captureJsonWrite(page, /\/v1\/purchase-orders\/[^/]+\/actual-costs$/u, { id: "f8000000-0000-4000-8000-000000000101" }, 201);

    await page.getByRole("button", { name: "Record actual" }).click();

    await expect.poll(requestBody).toMatchObject({
      invoice_number: "UI-VENDOR-104",
      amount: 850,
      description: "UI colour correction invoice",
    });
  });

  test("closes a client PO from its own register without touching vendor procurement", async ({ page }) => {
    await page.goto("/budget/client-purchase-orders");
    await page.locator('a[href^="/budget/client-purchase-orders/"]').first().click();
    const requestBody = await captureJsonWrite(page, /\/v1\/client-purchase-orders\/[^/]+$/u);

    await page.getByRole("button", { name: "Close client PO" }).click();

    await expect.poll(requestBody).toMatchObject({ status: "closed" });
  });

  test("saves a master service price through the rate-card control", async ({ page }) => {
    await page.goto("/budget");
    await page.route("**/v1/rate-cards/overrides?*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ overrides: {}, inherited: {} }) });
    });
    await page.getByRole("button", { name: "Manage rate card" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByRole("spinbutton", { name: "Master rate", exact: true }).fill("999");
    const requestBody = await captureJsonWrite(page, "**/v1/rate-cards/overrides");

    await page.getByRole("button", { name: "Save master rate" }).click();

    await expect.poll(requestBody).toMatchObject({ scope: "master", rate: 999 });
  });

  test("uses the same service, room, and artist panels on the master card", async ({ page }) => {
    await page.goto("/budget");
    await page.getByRole("button", { name: "Manage rate card" }).click();

    await expect(page.getByRole("heading", { name: "Service prices" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Room prices" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Named artist rates" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add service rate" })).toBeVisible();
  });
});
