import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { useDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const ACTUAL_EXTENSION_BOOKING_ID = "f5000000-0000-4000-8000-000000000001";
const ACTUAL_EXTENSION_BOOKING_TITLE = "Actual calendar extension test";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for booking calendar UI tests.");
const sql = postgres(databaseUrl, { prepare: false });

test.beforeEach(async ({ context }) => {
  await useDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.afterEach(async () => {
  await sql`delete from bookings where id = ${ACTUAL_EXTENSION_BOOKING_ID}`;
});

test.afterAll(async () => {
  await sql.end();
});

async function openBookings(page: Page) {
  await page.goto("/bookings");
  await page.waitForTimeout(400);
}

test.describe("Bookings UI", () => {
  test("shows the active tenant's room calendar", async ({ page }) => {
    await openBookings(page);

    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
    await expect(page.getByText("Post floor calendar · Copperline Editorial")).toBeVisible();
    await expect(page.getByText("Copper Cut 1", { exact: true }).first()).toBeVisible();
    await expect(bookingBars(page).first()).toBeVisible();
  });

  test("switches between week and day calendar views", async ({ page }) => {
    await openBookings(page);

    const weeklyCount = await visibleBookingCount(page);
    await page.getByRole("button", { name: "Day", exact: true }).click();
    const dailyCount = await visibleBookingCount(page);
    expect(dailyCount).toBeLessThanOrEqual(weeklyCount);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect.poll(() => visibleBookingCount(page)).toBe(weeklyCount);
  });

  test("shows a staff-centric day sheet with operational handover and catering context", async ({ page }) => {
    await openBookings(page);

    await page.getByRole("button", { name: "Staff day", exact: true }).click();
    await expect(page.getByText("Next booking", { exact: true })).toBeVisible();
    await expect(page.getByText("Call / start", { exact: true })).toBeVisible();
    await expect(page.getByText("Handover note", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("Catering", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("Maya Ortiz", { exact: true })).toBeVisible();
  });

  test("opens the episode booking sequence copy template", async ({ page }) => {
    await openBookings(page);
    await page.getByRole("button", { name: "Copy episode sequence" }).click();
    await expect(page.getByRole("heading", { name: "Copy episode booking sequence" })).toBeVisible();
    await expect(page.getByText("First client booking date", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy sequence" })).toBeVisible();
  });

  test("explains a missing booking title before save", async ({ page }) => {
    await openBookings(page);

    await page.getByRole("button", { name: "New booking" }).click();
    await expect(page.getByRole("heading", { name: "Book a post suite" })).toBeVisible();
    await page.getByRole("button", { name: "Save booking", exact: true }).click();

    await expect(page.getByText("A booking title is required.")).toBeVisible();
  });

  test("searches guest accounts and offers episode-scoped account creation", async ({ page }) => {
    await openBookings(page);

    await page.getByRole("button", { name: "New booking" }).click();
    const guestSearch = page.getByRole("textbox", { name: "Search guest accounts" });
    const createGuest = page.getByRole("button", { name: "Create", exact: true });
    await expect(guestSearch).toBeVisible();
    await guestSearch.fill("review");
    await expect(createGuest).toBeDisabled();

    await page.getByRole("combobox", { name: "Episode", exact: true }).selectOption({ index: 1 });
    await expect(createGuest).toBeEnabled();
    await createGuest.click();
    await expect(page.getByRole("heading", { name: "Create guest account" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Post-house role" })).toHaveCount(0);
  });

  test("opens an existing booking for editing without changing it", async ({ page }) => {
    await openBookings(page);

    const booking = page.getByRole("button", { name: /^Edit / }).first();
    await booking.click();
    await expect(page.getByRole("heading", { name: "Edit booking" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit booking" })).not.toBeVisible();
  });

  test("extends a booking bar to its confirmed actual end time", async ({ page }) => {
    const [[room], [episode], [person]] = await Promise.all([
      sql<{ id: string }[]>`select id from rooms where organization_id = ${COPPERLINE_ORGANIZATION_ID} and type = 'edit_bay' limit 1`,
      sql<{ id: string }[]>`select id from episodes where organization_id = ${COPPERLINE_ORGANIZATION_ID} limit 1`,
      sql<{ id: string }[]>`select id from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and role = 'editor' limit 1`,
    ]);
    if (!room || !episode || !person) throw new Error("Copperline booking test resources are missing.");
    const start = new Date(); start.setHours(9, 0, 0, 0);
    const plannedEnd = new Date(start); plannedEnd.setHours(16, 0, 0, 0);
    const actualEnd = new Date(start); actualEnd.setHours(18, 0, 0, 0);
    await sql`insert into bookings (id, organization_id, room_id, episode_id, person_id, title, starts_at, ends_at, actual_starts_at, actual_ends_at, status, booking_type) values (${ACTUAL_EXTENSION_BOOKING_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${room.id}, ${episode.id}, ${person.id}, ${ACTUAL_EXTENSION_BOOKING_TITLE}, ${start}, ${plannedEnd}, ${start}, ${actualEnd}, 'confirmed', 'edit')`;

    await openBookings(page);
    const bar = page.getByTestId(`booking-bar-${ACTUAL_EXTENSION_BOOKING_ID}`);
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("title", /Operational: 09:00–18:00/);
    expect(await bar.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(240);
  });
});

async function visibleBookingCount(page: Page) {
  return bookingBars(page).count();
}

function bookingBars(page: Page) {
  return page.getByRole("button", { name: /^Edit / });
}
