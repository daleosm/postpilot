import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for work-order UI tests.");
const sql = postgres(databaseUrl, { prepare: false });

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const EPISODE_ID = "27500000-0000-4000-8000-000000000001";
const TEST_WORK_ORDER_ID = "f6000000-0000-4000-8000-000000000001";
const TEST_BOOKING_ID = "f7000000-0000-4000-8000-000000000001";
const TEST_WORK_ORDER_TITLE = "UI scheduleable internal work";
const TEST_BOOKING_TITLE = "UI actual-time booking";

async function clearFixtures() {
  await sql`delete from post_work_orders where id = ${TEST_WORK_ORDER_ID}`;
  await sql`delete from bookings where id = ${TEST_BOOKING_ID}`;
}

// The suite uses fixed IDs so it can exercise direct database setup. Clean
// before every case too: an interrupted browser run must not poison its retry.
test.beforeEach(async () => {
  await clearFixtures();
});

test.afterEach(async () => {
  await clearFixtures();
});

test.afterAll(async () => {
  await sql.end();
});

test.describe("Work-order operational UI", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("creates a client-billable work-order draft with its line-item payload", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_ID}`);
    await page.getByRole("button", { name: "Work orders", exact: true }).click();
    await page.getByRole("button", { name: "New work order" }).click();
    const form = page.locator('input[placeholder="External caption correction"]').locator("xpath=ancestor::form[1]");
    await form.locator('input[name="title"]').fill("UI client change request");
    await form.getByLabel("Billing treatment").selectOption("billable_change");
    await form.getByLabel("Quoted client change").fill("480");
    await form.getByLabel("Client approval reference").fill("Approved in client review");
    await form.getByRole("button", { name: "Add line" }).click();
    await form.getByLabel("Line item 1 description").fill("Additional online pass");
    await form.getByLabel("Line item 1 quantity").fill("3");
    await form.getByLabel("Line item 1 rate").fill("160");
    const requestBody = await captureJsonWrite(page, "**/v1/work-orders", { id: "f6000000-0000-4000-8000-000000000099" }, 201);

    await form.getByRole("button", { name: "Save draft" }).click();

    await expect.poll(requestBody).toMatchObject({
      episode_id: EPISODE_ID,
      title: "UI client change request",
      billing_scope: "billable_change",
      client_quote_amount: 480,
      billing_notes: "Approved in client review",
      items: [{ description: "Additional online pass", quantity: 3, unit_rate: 160 }],
    });
  });

  test("makes a flat-fee work order explicitly client-billable", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_ID}`);
    await page.getByRole("button", { name: "Work orders", exact: true }).click();
    await page.getByRole("button", { name: "New work order" }).click();
    const form = page.locator('input[placeholder="External caption correction"]').locator("xpath=ancestor::form[1]");

    await form.getByLabel("Commercial treatment").selectOption("flat_project_fee");

    await expect(form.getByLabel("Billing treatment")).toBeDisabled();
    await expect(form.getByLabel("Billing treatment")).toHaveValue("billable_change");
    await expect(form.getByLabel("Agreed project fee")).toBeVisible();
    await expect(form.getByText("One agreed client fee; scheduled room and artist time remains internal cost.")).toBeVisible();
  });

  test("only exposes supplier and PO controls for external vendor work", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_ID}`);
    await page.getByRole("button", { name: "Work orders", exact: true }).click();
    await page.getByRole("button", { name: "New work order" }).click();
    const form = page.locator('input[placeholder="External caption correction"]').locator("xpath=ancestor::form[1]");
    await expect(form.locator("button").filter({ hasText: "Internal work" })).toHaveAttribute("aria-pressed", "true");
    await expect(form.locator('select[name="vendorCompanyId"]')).toHaveCount(0);
    await expect(form.locator('input[name="estimatedAmount"]')).toHaveCount(0);

    await form.locator("button").filter({ hasText: "External vendor work" }).click();

    await expect(form.locator('select[name="vendorCompanyId"]')).toBeVisible();
    await expect(form.locator('select[name="purchaseOrderId"]')).toBeDisabled();
    await expect(form.locator('input[name="estimatedAmount"]')).toBeVisible();
  });

  test("sends an explicit approval decision for a pending work order", async ({ page }) => {
    await sql`
      insert into post_work_orders (
        id, organization_id, episode_id, work_type, kind, title
        is_blocking, status, billing_scope, billing_status, currency
      ) values (
        ${TEST_WORK_ORDER_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${EPISODE_ID}, 'internal', 'work_order',
        ${TEST_WORK_ORDER_TITLE}, false, 'awaiting_approval', 'included', 'not_billable', 'USD'
      )
    `;
    await page.goto(`/episodes/${EPISODE_ID}`);
    await page.getByRole("button", { name: "Work orders", exact: true }).click();
    const row = page.getByRole("article").filter({ hasText: TEST_WORK_ORDER_TITLE });
    await row.getByLabel(`Approval note for ${TEST_WORK_ORDER_TITLE}`).fill("Approved for the current turnover.");
    const requestBody = await captureJsonWrite(page, `**/v1/work-orders/${TEST_WORK_ORDER_ID}`);

    await row.getByRole("button", { name: "Approve" }).click();

    await expect.poll(requestBody).toMatchObject({
      status: "in_progress",
      approval_note: "Approved for the current turnover.",
    });
  });
});

test.describe("Work-order reservation and time confirmation UI", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_copper_editor", COPPERLINE_ORGANIZATION_ID);
  });

  test("reserves a room from an assigned internal work order", async ({ page }) => {
    const [editor] = await sql<{ id: string }[]>`
      select id from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id = 'user_copper_editor' limit 1
    `;
    if (!editor) throw new Error("Copperline editor fixture is missing.");
    await sql`
      insert into post_work_orders (
        id, organization_id, episode_id, work_type, kind, title
        is_blocking, status, billing_scope, billing_status, currency, assignee_person_id
      ) values (
        ${TEST_WORK_ORDER_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${EPISODE_ID}, 'internal', 'work_order',
        ${TEST_WORK_ORDER_TITLE}, false, 'ready_for_review', 'included', 'not_billable', 'USD', ${editor.id}
      )
    `;
    await page.goto("/bookings");
    await page.getByRole("button", { name: `Reserve work order ${TEST_WORK_ORDER_TITLE}` }).click();
    await expect(page.getByRole("heading", { name: TEST_WORK_ORDER_TITLE })).toBeVisible();
    await page.getByLabel("Suite / room").selectOption({ index: 1 });
    const requestBody = await captureJsonWrite(page, `**/v1/work-orders/${TEST_WORK_ORDER_ID}/booking`, { id: "f7000000-0000-4000-8000-000000000099" }, 201);

    await page.getByRole("button", { name: "Reserve room" }).click();

    await expect.poll(requestBody).toMatchObject({ room_id: expect.any(String) });
  });

  test("requires an assigned worker to place a booking before completion", async ({ page }) => {
    const [editor] = await sql<{ id: string }[]>`
      select id from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id = 'user_copper_editor' limit 1
    `;
    if (!editor) throw new Error("Copperline editor fixture is missing.");
    await sql`
      insert into post_work_orders (
        id, organization_id, episode_id, work_type, kind, title
        is_blocking, status, billing_scope, billing_status, currency, assignee_person_id
      ) values (
        ${TEST_WORK_ORDER_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${EPISODE_ID}, 'internal', 'work_order',
        ${TEST_WORK_ORDER_TITLE}, false, 'ready_for_review', 'included', 'not_billable', 'USD', ${editor.id}
      )
    `;

    await page.goto("/review");
    const row = page.getByRole("article").filter({ hasText: TEST_WORK_ORDER_TITLE });
    await expect(row.getByRole("button", { name: "Schedule on board" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Mark complete" })).toHaveCount(0);

    await row.getByRole("button", { name: "Schedule on board" }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings\\?workOrder=${TEST_WORK_ORDER_ID}`));
    await expect(page.getByRole("button", { name: `Reserve work order ${TEST_WORK_ORDER_TITLE}` })).toBeVisible();
    await expect(page.getByText("Selected from My work · drag to a room")).toBeVisible();
    await expect(page.getByRole("heading", { name: TEST_WORK_ORDER_TITLE })).toHaveCount(0);
  });

  test("routes assigned internal work to linked booking time and overtime entry", async ({ page }) => {
    const [editor] = await sql<{ id: string }[]>`
      select id from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id = 'user_copper_editor' limit 1
    `;
    if (!editor) throw new Error("Copperline editor fixture is missing.");
    await sql`
      insert into bookings (
        id, organization_id, episode_id, room_id, person_id, title,
        starts_at, ends_at, status, booking_type
      ) values (
        ${TEST_BOOKING_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${EPISODE_ID},
        (select id from rooms where organization_id = ${COPPERLINE_ORGANIZATION_ID} order by name limit 1),
        ${editor.id}, ${TEST_BOOKING_TITLE}, now() - interval '3 hours', now() - interval '2 hours', 'confirmed', 'edit'
      )
    `;
    await sql`
      insert into post_work_orders (
        id, organization_id, episode_id, booking_id, work_type, kind, title
        is_blocking, status, billing_scope, billing_status, currency, assignee_person_id
      ) values (
        ${TEST_WORK_ORDER_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${EPISODE_ID}, ${TEST_BOOKING_ID}, 'internal', 'work_order',
        ${TEST_WORK_ORDER_TITLE}, false, 'in_progress', 'included', 'not_billable', 'USD', ${editor.id}
      )
    `;

    await page.goto("/review");
    const row = page.getByRole("article").filter({ hasText: TEST_WORK_ORDER_TITLE });
    await expect(row.getByRole("button", { name: "Record time & overtime" })).toBeVisible();
    await row.getByRole("button", { name: "Record time & overtime" }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings\\?booking=${TEST_BOOKING_ID}`));
  });

  test("submits actual time and overtime from an artist's personal workspace", async ({ page }) => {
    const [editor] = await sql<{ id: string }[]>`
      select id from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id = 'user_copper_editor' limit 1
    `;
    if (!editor) throw new Error("Copperline editor fixture is missing.");
    await sql`
      insert into bookings (id, organization_id, person_id, title, starts_at, ends_at, status, booking_type)
      values (
        ${TEST_BOOKING_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${editor.id}, ${TEST_BOOKING_TITLE},
        now() - interval '3 hours', now() - interval '2 hours', 'confirmed', 'edit'
      )
    `;
    await page.goto("/review");
    const row = page.getByRole("article").filter({ hasText: TEST_BOOKING_TITLE });
    await row.getByRole("button", { name: "Confirm actual time" }).click();
    await page.getByLabel("Overtime minutes").fill("45");
    await page.getByLabel("Handover / time note").fill("Client playback ran over.");
    const requestBody = await captureJsonWrite(page, `**/v1/bookings/${TEST_BOOKING_ID}/time-submissions`, { id: "f7000000-0000-4000-8000-000000000100" }, 201);

    await page.getByRole("button", { name: "Confirm time" }).click();

    await expect.poll(requestBody).toMatchObject({
      overtime_minutes: 45,
      note: "Client playback ran over.",
      actual_starts_at: expect.any(String),
      actual_ends_at: expect.any(String),
    });
    await expect(page.getByRole("heading", { name: "Confirm actual time" })).toHaveCount(0);
  });
});
