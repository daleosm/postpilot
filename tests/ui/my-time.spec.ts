import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { useDebugSession } from "../fixtures/debug-session";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for My Time UI tests.");
const sql = postgres(databaseUrl, { prepare: false });
const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const COPPERLINE_EDITOR_USER_ID = "user_copper_editor";
const TEST_BOOKING_ID = "f3000000-0000-4000-8000-000000000001";
const TEST_BOOKING_TITLE = "My time confirmation test booking";

test.beforeEach(async ({ context }) => {
  await useDebugSession(context, COPPERLINE_EDITOR_USER_ID, COPPERLINE_ORGANIZATION_ID);
});

test.afterEach(async () => {
  await sql`delete from bookings where id = ${TEST_BOOKING_ID}`;
});

test.afterAll(async () => {
  await sql.end();
});

test.describe("My time UI", () => {
  test("gives an artist a personal time-confirmation workspace without the facility calendar", async ({ page }) => {
    const [editor] = await sql<{ id: string }[]>`
      select id from people
      where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id = ${COPPERLINE_EDITOR_USER_ID}
      limit 1
    `;
    if (!editor) throw new Error("Copperline editor test person is missing.");

    await sql`delete from bookings where id = ${TEST_BOOKING_ID}`;
    await sql`
      insert into bookings (id, organization_id, person_id, title, starts_at, ends_at, status, booking_type)
      values (
        ${TEST_BOOKING_ID},
        ${COPPERLINE_ORGANIZATION_ID},
        ${editor.id},
        ${TEST_BOOKING_TITLE},
        now() - interval '3 hours',
        now() - interval '2 hours',
        'confirmed',
        'edit'
      )
    `;

    await page.goto("/my-time");

    await expect(page.getByRole("heading", { name: "My time", exact: true })).toBeVisible();
    await expect(page.getByText("Confirm the actual time you worked.")).toBeVisible();
    await expect(page.getByRole("link", { name: "My time", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings", exact: true })).not.toBeVisible();
    const testBooking = page.getByRole("article").filter({ hasText: TEST_BOOKING_TITLE });
    await expect(testBooking).toBeVisible();
    await testBooking.getByRole("button", { name: "Confirm actual time", exact: true }).click();
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
