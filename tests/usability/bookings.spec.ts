import { expect, test, type Page } from "@playwright/test";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "postpilot.debugUser", value: "user_maya", url: "http://localhost:5001" },
    { name: "posthouse.activeOrganizationId", value: COPPERLINE_ORGANIZATION_ID, url: "http://localhost:5001" },
  ]);
});

async function openBookings(page: Page) {
  await page.goto("/bookings");
  await page.waitForTimeout(400);
}

test.describe("Bookings usability", () => {
  test("shows the active tenant's room calendar and utilization", async ({ page }) => {
    await openBookings(page);

    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
    await expect(page.getByText("Post floor calendar · Copperline Editorial")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Room utilization" })).toBeVisible();
    await expect(page.getByText("Copper Cut 1", { exact: true }).first()).toBeVisible();
    await expect(bookingCount(page)).toBeVisible();
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

function bookingCount(page: Page) {
  return page.getByText(/bookings in view/);
}

async function visibleBookingCount(page: Page) {
  const label = bookingCount(page);
  await expect(label).toBeVisible();
  return Number((await label.textContent())?.match(/(\d+) bookings in view/)?.[1]);
}
