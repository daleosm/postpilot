import { expect, test, type Page } from "@playwright/test";
import { useDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await useDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
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
});

async function visibleBookingCount(page: Page) {
  return bookingBars(page).count();
}

function bookingBars(page: Page) {
  return page.getByRole("button", { name: /^Edit / });
}
