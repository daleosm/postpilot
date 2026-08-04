import { expect, test, type Page } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

async function openBookingDialog(page: Page) {
  await page.goto("/bookings");
  await page.getByRole("button", { name: "New booking" }).click();
  await expect(page.getByRole("dialog", { name: "New booking" })).toBeVisible();
}

async function fillBookingBasics(page: Page, title: string) {
  await page.getByLabel("Booking title").fill(title);
  await page.getByLabel("Room / suite").selectOption({ index: 1 });
  await page.getByLabel("Assigned artist").selectOption({ index: 1 });
  await page.locator('select[name="episodeId"]').selectOption({ index: 1 });
  await page.getByLabel("Client booking starts").fill("2034-08-15T09:00");
  await page.getByLabel("Client booking ends").fill("2034-08-15T12:00");
}

test.describe("Booking creation and conflict UX", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("submits an hourly booking with its operational buffers", async ({ page }) => {
    await openBookingDialog(page);
    await fillBookingBasics(page, "UI hourly edit booking");
    await page.getByLabel("Setup (min)").fill("20");
    await page.getByLabel("Handover (min)").fill("15");
    const requestBody = await captureJsonWrite(page, "**/v1/bookings", { id: "a5000000-0000-4000-8000-000000000001" }, 201);

    await page.getByRole("button", { name: "Save booking" }).click();

    await expect.poll(requestBody).toMatchObject({
      title: "UI hourly edit booking",
      booking_type: "edit",
      status: "confirmed",
      setup_minutes: 20,
      handover_minutes: 15,
      is_option: false,
    });
    await expect(page.getByRole("dialog", { name: "New booking" })).toHaveCount(0);
  });

  test("shows server-resolved room and artist charges without offering a price field", async ({ page }) => {
    await page.route("**/v1/bookings/commercial-preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          components: [
            {
              component_type: "room", resource: "Copper Cut 1", category: "Edit suite", rate: 100,
              unit: "hour", currency: "GBP", source: "show_rate_card", estimated_quantity: 3,
              estimated_charge: 300, pricing_status: "resolved",
            },
            {
              component_type: "person", resource: "Mark Dyer", category: "Edit suite", rate: 175,
              unit: "hour", currency: "GBP", source: "episode_rate_card", estimated_quantity: 3,
              estimated_charge: 525, pricing_status: "resolved",
            },
          ],
        }),
      });
    });
    await openBookingDialog(page);
    await fillBookingBasics(page, "UI commercial preview");

    const dialog = page.getByRole("dialog", { name: "New booking" });
    await expect(dialog.getByText("Commercial preview", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Copper Cut 1", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Mark Dyer", { exact: true })).toBeVisible();
    await expect(dialog.getByText("£300.00 est.", { exact: true })).toBeVisible();
    await expect(dialog.getByText("£525.00 est.", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Client rate", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Set negotiated price" }).first().click();
    await dialog.getByLabel("Negotiated room rate").fill("123.45");
    await dialog.getByLabel("Negotiated room reason").fill("Client agreed a late suite rate.");
    const bookingBody = await captureJsonWrite(page, "**/v1/bookings", { id: "a5000000-0000-4000-8000-000000000006" }, 201);

    await dialog.getByRole("button", { name: "Save booking" }).click();

    await expect.poll(bookingBody).toMatchObject({
      commercial_overrides: [{ component_type: "room", rate: 123.45, reason: "Client agreed a late suite rate." }],
    });
  });

  test("turns a provisional reservation into an explicit pencil hold payload", async ({ page }) => {
    await openBookingDialog(page);
    await fillBookingBasics(page, "UI pencil hold");
    await page.getByText("Option booking / pencil hold", { exact: true }).click();
    const requestBody = await captureJsonWrite(page, "**/v1/bookings", { id: "a5000000-0000-4000-8000-000000000002" }, 201);

    await page.getByRole("button", { name: "Save booking" }).click();

    await expect.poll(requestBody).toMatchObject({
      title: "UI pencil hold",
      is_option: true,
      status: "tentative",
    });
  });

  test("turns a conflict response into precise alternatives that update the form", async ({ page }) => {
    await openBookingDialog(page);
    await fillBookingBasics(page, "UI conflict check");
    const alternativeRoom = await page.getByLabel("Room / suite").locator("option").nth(2).evaluate((option) => ({
      id: (option as HTMLOptionElement).value,
      name: option.textContent?.split(" · ")[0] ?? "Available room",
    }));
    await page.route("**/v1/bookings/conflicts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conflicts: [{
            id: "a5000000-0000-4000-8000-000000000003",
            title: "Existing grade booking",
            starts_at: "2034-08-15T09:00:00.000Z",
            ends_at: "2034-08-15T12:00:00.000Z",
            setup_minutes: 15,
            handover_minutes: 15,
            booking_type: "color",
            room_name: "Copper Cut 1",
            person_name: "Mark Dyer",
            person_availability: "available",
            person_is_freelancer: false,
            overlaps: ["room", "person"],
          }],
          available_rooms: [{ id: alternativeRoom.id, name: alternativeRoom.name, type: "edit_bay" }],
          available_people: [{ id: "24050000-0000-4000-8000-000000000005", name: "Tariq Moon", role: "colorist", availability: "available", is_freelancer: false }],
          nearest_slot: { starts_at: "2034-08-16T13:00:00.000Z", ends_at: "2034-08-16T16:00:00.000Z" },
        }),
      });
    });

    await page.getByRole("button", { name: "Check availability" }).click();

    await expect(page.getByText("1 conflict found")).toBeVisible();
    await expect(page.getByText("Existing grade booking")).toBeVisible();
    await page.getByRole("button", { name: alternativeRoom.name, exact: true }).click();
    await expect(page.getByLabel("Room / suite")).toHaveValue(alternativeRoom.id);
    await page.getByRole("button", { name: /Next client slot/ }).click();
    const startsAt = await page.getByLabel("Client booking starts").inputValue();
    const endsAt = await page.getByLabel("Client booking ends").inputValue();
    expect(startsAt).toMatch(/^2034-08-16T/);
    expect(new Date(endsAt).getTime() - new Date(startsAt).getTime()).toBe(3 * 60 * 60 * 1000);
  });

  test("creates a guest account in the booking flow and selects it for the episode", async ({ page }) => {
    await openBookingDialog(page);
    await page.locator('select[name="episodeId"]').selectOption({ index: 1 });
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByLabel("Name").fill("UI Guest Reviewer");
    await page.getByLabel("Email").fill("ui.guest@example.test");
    await page.locator('input[name="password"]').fill("guest-access-password");
    await page.locator('input[name="confirmPassword"]').fill("guest-access-password");
    const requestBody = await captureJsonWrite(page, "**/v1/bookings/guest-accounts", {
      id: "a5000000-0000-4000-8000-000000000004",
      name: "UI Guest Reviewer",
      role: "client",
      email: "ui.guest@example.test",
    }, 201);

    await page.getByRole("button", { name: "Create guest" }).click();

    await expect.poll(requestBody).toMatchObject({ name: "UI Guest Reviewer", email: "ui.guest@example.test", password: "guest-access-password" });
    await expect(page.getByRole("dialog", { name: "Create guest account" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Search guest accounts" })).toHaveValue("UI Guest Reviewer");
  });

  test("keeps guest details but clears passwords after a rejected account request", async ({ page }) => {
    await openBookingDialog(page);
    await page.locator('select[name="episodeId"]').selectOption({ index: 1 });
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByLabel("Name").fill("Rejected Guest");
    await page.getByLabel("Email").fill("rejected.guest@example.test");
    await page.locator('input[name="password"]').fill("guest-password-one");
    await page.locator('input[name="confirmPassword"]').fill("guest-password-two");
    let requests = 0;
    await page.route("**/v1/bookings/guest-accounts", async (route) => {
      requests += 1;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "This person already has access to this post house." }) });
    });

    await page.getByRole("button", { name: "Create guest" }).click();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();
    expect(requests).toBe(0);
    await page.locator('input[name="password"]').fill("guest-safe-password");
    await page.locator('input[name="confirmPassword"]').fill("guest-safe-password");
    await page.getByRole("button", { name: "Create guest" }).click();
    await expect(page.getByText("This person already has access to this post house.", { exact: true })).toBeVisible();
    expect(requests).toBe(1);
    await expect(page.getByLabel("Name")).toHaveValue("Rejected Guest");
    await expect(page.getByLabel("Email")).toHaveValue("rejected.guest@example.test");
    await expect(page.locator('input[name="password"]')).toHaveValue("");
    await expect(page.locator('input[name="confirmPassword"]')).toHaveValue("");
  });
});
