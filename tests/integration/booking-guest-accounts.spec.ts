import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for booking guest-account tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "95000000-0000-4000-8000-000000000001";
const managerUserId = "user_booking_guest_manager";
const guestUserId = "user_booking_guest_attendee";
const memberUserId = "user_booking_member_attendee";
const managerPersonId = "95000000-0000-4000-8000-000000000002";
const guestPersonId = "95000000-0000-4000-8000-000000000003";
const memberPersonId = "95000000-0000-4000-8000-000000000004";
const showId = "95000000-0000-4000-8000-000000000005";
const seasonId = "95000000-0000-4000-8000-000000000006";
const episodeId = "95000000-0000-4000-8000-000000000007";
const roomId = "95000000-0000-4000-8000-000000000008";
const createdGuestEmail = "new-booking-guest@postpilot.test";
const foreignOrganizationId = "95000000-0000-4000-8000-000000000009";
const foreignShowId = "95000000-0000-4000-8000-000000000010";
const foreignSeasonId = "95000000-0000-4000-8000-000000000011";
const foreignEpisodeId = "95000000-0000-4000-8000-000000000012";

function bookingPayload(guestPersonId: string | null) {
  return {
    title: "Guest review session",
    roomId,
    episodeId,
    personId: null,
    guestPersonId,
    startsAt: "2034-06-10T10:00:00.000Z",
    endsAt: "2034-06-10T12:00:00.000Z",
    setupMinutes: 15,
    handoverMinutes: 0,
    status: "confirmed",
    bookingType: "client_review",
    notes: null,
  };
}

async function useManagerSession(page: Page) {
  const user = await page.request.post("/api/debug/user", { data: { userId: managerUserId } });
  expect(user.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/bookings" } });
  expect(tenant.status()).toBe(200);
}

test.describe("Booking guest accounts", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await sql`
      insert into users (id, name, email) values
        (${managerUserId}, 'Booking Guest Manager', 'booking-guest-manager@postpilot.test'),
        (${guestUserId}, 'Booking Guest Attendee', 'booking-guest-attendee@postpilot.test'),
        (${memberUserId}, 'Booking Member Attendee', 'booking-member-attendee@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Booking Guest Lab', 'booking-guest-lab')`;
    await sql`
      insert into organization_members (organization_id, user_id, role) values
        (${organizationId}, ${managerUserId}, 'admin'),
        (${organizationId}, ${guestUserId}, 'guest'),
        (${organizationId}, ${memberUserId}, 'member')
    `;
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions) values
        (${organizationId}, 'client_reviewer', 'Client reviewer', '["manage_bookings"]'::jsonb)
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role) values
        (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Booking Guest Manager', 'booking-guest-manager@postpilot.test', 'producer'),
        (${guestPersonId}, ${organizationId}, ${guestUserId}, 'Booking Guest Attendee', 'booking-guest-attendee@postpilot.test', 'client_reviewer'),
        (${memberPersonId}, ${organizationId}, ${memberUserId}, 'Booking Member Attendee', 'booking-member-attendee@postpilot.test', 'producer')
    `;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Booking Guest Series', 'BGS', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number, title) values (${seasonId}, ${organizationId}, ${showId}, 1, 'Booking Guest Series · Season 1')`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, 1, 'Guest review episode', 'review', 'not_started')`;
    await sql`insert into rooms (id, organization_id, name, type) values (${roomId}, ${organizationId}, 'Guest Review Room', 'client_review')`;
    await sql`insert into organizations (id, name, slug) values (${foreignOrganizationId}, 'Foreign Booking Guest Lab', 'foreign-booking-guest-lab')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Booking Series', 'FBG', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number, title) values (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1, 'Foreign Booking Series · Season 1')`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'Foreign review episode', 'review', 'not_started')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await sql`delete from users where id in (${managerUserId}, ${guestUserId}, ${memberUserId}) or email = ${createdGuestEmail}`;
    await sql.end();
  });

  test("adds a selected guest account to the booked episode team only once", async ({ page }) => {
    await useManagerSession(page);
    const create = await page.request.post("/api/bookings", { data: bookingPayload(guestPersonId) });
    expect(create.status()).toBe(201);
    const bookingId = (await create.json()).id as string;

    const [booking] = await sql`select guest_person_id from bookings where id = ${bookingId}`;
    expect(booking.guest_person_id).toBe(guestPersonId);
    const [assignment] = await sql`select person_id, responsibility from episode_team_assignments where organization_id = ${organizationId} and episode_id = ${episodeId} and person_id = ${guestPersonId}`;
    expect(assignment).toMatchObject({ person_id: guestPersonId, responsibility: "client_reviewer" });

    const update = await page.request.patch(`/api/bookings/${bookingId}`, { data: { ...bookingPayload(guestPersonId), title: "Updated guest review session" } });
    expect(update.status()).toBe(200);
    const [count] = await sql`select count(*)::int as count from episode_team_assignments where organization_id = ${organizationId} and episode_id = ${episodeId} and person_id = ${guestPersonId}`;
    expect(count.count).toBe(1);
  });

  test("rejects a non-guest account as a booking guest", async ({ page }) => {
    await useManagerSession(page);
    const response = await page.request.post("/api/bookings", { data: { ...bookingPayload(memberPersonId), startsAt: "2034-06-11T10:00:00.000Z", endsAt: "2034-06-11T12:00:00.000Z" } });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Guest account not found for this organization." });
  });

  test("creates a tenant guest account and shares the selected episode", async ({ page }) => {
    await useManagerSession(page);

    const response = await page.request.post("/api/bookings/guest-accounts", {
      data: {
        episodeId,
        name: "New Booking Guest",
        email: createdGuestEmail,
        // The booking form must not be able to turn an external attendee into
        // an internal post-house role.
        personRole: "producer",
      },
    });

    expect(response.status()).toBe(201);
    const guest = await response.json() as { id: string; name: string; role: string; email: string };
    expect(guest).toMatchObject({ name: "New Booking Guest", role: "guest", email: createdGuestEmail });

    const [membership] = await sql`
      select organization_members.role
      from organization_members
      inner join people on people.user_id = organization_members.user_id
      where organization_members.organization_id = ${organizationId}
        and people.id = ${guest.id}
    `;
    expect(membership.role).toBe("guest");

    const [assignment] = await sql`
      select person_id, responsibility
      from episode_team_assignments
      where organization_id = ${organizationId}
        and episode_id = ${episodeId}
        and person_id = ${guest.id}
    `;
    expect(assignment).toMatchObject({ person_id: guest.id, responsibility: "guest" });
  });

  test("rejects creating a guest account for an episode in another post house", async ({ page }) => {
    await useManagerSession(page);

    const response = await page.request.post("/api/bookings/guest-accounts", {
      data: {
        episodeId: foreignEpisodeId,
        name: "Cross Tenant Guest",
        email: "cross-tenant-guest@postpilot.test",
        personRole: "client_reviewer",
      },
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Episode not found for this post house." });
    const [person] = await sql`select id from people where organization_id = ${organizationId} and email = 'cross-tenant-guest@postpilot.test'`;
    expect(person).toBeUndefined();
  });

  test("does not let a guest membership schedule despite a broad tenant policy", async ({ page }) => {
    const user = await page.request.post("/api/debug/user", { data: { userId: guestUserId } });
    expect(user.status()).toBe(200);
    const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/bookings" } });
    expect(tenant.status()).toBe(200);

    const create = await page.request.post("/api/bookings", { data: bookingPayload(null) });
    expect(create.status()).toBe(403);
    const copy = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId: episodeId, targetEpisodeId: foreignEpisodeId, startsOn: "2034-06-12T09:00:00.000Z" } });
    expect(copy.status()).toBe(403);
  });
});
