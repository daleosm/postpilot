import { expect, test, type Page } from "@playwright/test";

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
    await expect(page.getByText("Copper Cut 1", { exact: true })).toBeVisible();
    await expect(page.getByText("5 bookings in view")).toBeVisible();
  });

  test("switches between week and day calendar views", async ({ page }) => {
    await openBookings(page);

    await expect(page.getByText("5 bookings in view")).toBeVisible();
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(page.getByText("1 bookings in view")).toBeVisible();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.getByText("5 bookings in view")).toBeVisible();
  });

  test("explains a missing booking title before save", async ({ page }) => {
    await openBookings(page);

    await page.getByRole("button", { name: "New booking" }).click();
    await expect(page.getByRole("heading", { name: "Book a post suite" })).toBeVisible();
    await page.getByRole("button", { name: "Save booking", exact: true }).click();

    await expect(page.getByText("A booking title is required.")).toBeVisible();
  });
});
