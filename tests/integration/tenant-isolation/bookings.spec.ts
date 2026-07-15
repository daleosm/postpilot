import { expect, test } from "@playwright/test";

const LANTERN_ROOM_ID = "28400000-0000-4000-8000-000000000001";
const LANTERN_EPISODE_ID = "27400000-0000-4000-8000-000000000001";
const LANTERN_EDITOR_ID = "24400000-0000-4000-8000-000000000003";

function foreignBooking(overrides: Record<string, unknown> = {}) {
  return {
    title: "Cross-tenant booking attempt",
    roomId: LANTERN_ROOM_ID,
    episodeId: null,
    personId: null,
    startsAt: "2026-07-12T09:00:00.000Z",
    endsAt: "2026-07-12T13:00:00.000Z",
    status: "confirmed",
    bookingType: "edit",
    notes: null,
    ...overrides,
  };
}

test.describe("Bookings tenant isolation", () => {
  test("rejects creation against a Lantern room from Copperline", async ({ page }) => {
    await page.goto("/bookings");

    const response = await page.request.post("/api/bookings", { data: foreignBooking() });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid room for this organization." });
  });

  test("rejects foreign episode and artist assignments", async ({ page }) => {
    await page.goto("/bookings");

    const response = await page.request.post("/api/bookings", {
      data: foreignBooking({ roomId: null, episodeId: LANTERN_EPISODE_ID, personId: LANTERN_EDITOR_ID }),
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid episode, person for this organization." });
  });

  test("does not reveal conflict data for a foreign room", async ({ page }) => {
    await page.goto("/bookings");

    const response = await page.request.post("/api/bookings/conflicts", { data: foreignBooking() });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid room for this organization." });
  });
});
