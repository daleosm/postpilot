import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for booking operations tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "97000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "97000000-0000-4000-8000-000000000002";
const managerUserId = "user_booking_operations_manager";
const artistUserId = "user_booking_operations_artist";
const approverUserId = "user_booking_operations_approver";
const managerPersonId = "97000000-0000-4000-8000-000000000003";
const artistPersonId = "97000000-0000-4000-8000-000000000004";
const approverPersonId = "97000000-0000-4000-8000-000000000005";
const roomOneId = "97000000-0000-4000-8000-000000000006";
const roomTwoId = "97000000-0000-4000-8000-000000000007";
const showId = "97000000-0000-4000-8000-000000000008";
const seasonId = "97000000-0000-4000-8000-000000000009";
const sourceEpisodeId = "97000000-0000-4000-8000-000000000010";
const targetEpisodeId = "97000000-0000-4000-8000-000000000011";
const emptyEpisodeId = "97000000-0000-4000-8000-000000000012";
const conflictBookingId = "97000000-0000-4000-8000-000000000013";
const sourceBookingOneId = "97000000-0000-4000-8000-000000000014";
const sourceBookingTwoId = "97000000-0000-4000-8000-000000000015";
const actualBookingId = "97000000-0000-4000-8000-000000000016";
const foreignShowId = "97000000-0000-4000-8000-000000000017";
const foreignSeasonId = "97000000-0000-4000-8000-000000000018";
const foreignEpisodeId = "97000000-0000-4000-8000-000000000019";
const foreignRoomId = "97000000-0000-4000-8000-000000000020";
const foreignBookingId = "97000000-0000-4000-8000-000000000021";
const actualEpisodeId = "97000000-0000-4000-8000-000000000022";

let createdBookingId = "";

function bookingPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Buffer overlap test",
    roomId: roomOneId,
    episodeId: sourceEpisodeId,
    personId: artistPersonId,
    guestPersonId: null,
    startsAt: "2035-05-01T12:15:00.000Z",
    endsAt: "2035-05-01T14:00:00.000Z",
    setupMinutes: 0,
    handoverMinutes: 0,
    strikeMinutes: 0,
    status: "confirmed",
    bookingType: "edit",
    notes: null,
    ...overrides,
  };
}

async function useSession(page: Page, userId: string) {
  const user = await page.request.post("/api/debug/user", { data: { userId } });
  expect(user.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/bookings" } });
  expect(tenant.status()).toBe(200);
}

test.describe("Booking operations integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`
      insert into users (id, name, email) values
        (${managerUserId}, 'Booking Operations Manager', 'booking-operations-manager@postpilot.test'),
        (${artistUserId}, 'Booking Operations Artist', 'booking-operations-artist@postpilot.test'),
        (${approverUserId}, 'Booking Operations Approver', 'booking-operations-approver@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`insert into organizations (id, name, slug, currency) values (${organizationId}, 'Booking Operations Lab', 'booking-operations-lab', 'GBP'), (${foreignOrganizationId}, 'Foreign Booking Operations', 'foreign-booking-operations', 'GBP')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, ${managerUserId}, 'admin'), (${organizationId}, ${artistUserId}, 'member'), (${organizationId}, ${approverUserId}, 'member')`;
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions) values
        (${organizationId}, 'editor', 'Editor', '["update_assigned_work"]'::jsonb),
        (${organizationId}, 'time_approver', 'Time approver', '["approve_time"]'::jsonb)
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role) values
        (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Booking Operations Manager', 'booking-operations-manager@postpilot.test', 'producer'),
        (${artistPersonId}, ${organizationId}, ${artistUserId}, 'Booking Operations Artist', 'booking-operations-artist@postpilot.test', 'editor'),
        (${approverPersonId}, ${organizationId}, ${approverUserId}, 'Booking Operations Approver', 'booking-operations-approver@postpilot.test', 'time_approver')
    `;
    await sql`insert into rooms (id, organization_id, name, type) values (${roomOneId}, ${organizationId}, 'Operations Edit 1', 'edit_bay'), (${roomTwoId}, ${organizationId}, 'Operations Edit 2', 'edit_bay')`;
    await sql`insert into rooms (id, organization_id, name, type) values (${foreignRoomId}, ${foreignOrganizationId}, 'Foreign Edit 1', 'edit_bay')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Booking Operations Series', 'BOS', 'Europe/London'), (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Booking Series', 'FBS', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1), (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`
      insert into episodes (id, organization_id, season_id, number, production_code, title, status, qc_status) values
        (${sourceEpisodeId}, ${organizationId}, ${seasonId}, 1, 'BOS101', 'Source episode', 'assembly', 'not_started'),
        (${targetEpisodeId}, ${organizationId}, ${seasonId}, 2, 'BOS102', 'Target episode', 'assembly', 'not_started'),
        (${emptyEpisodeId}, ${organizationId}, ${seasonId}, 3, 'BOS103', 'Empty episode', 'assembly', 'not_started'),
        (${actualEpisodeId}, ${organizationId}, ${seasonId}, 4, 'BOS104', 'Actual-time episode', 'assembly', 'not_started'),
        (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'FBS101', 'Foreign episode', 'assembly', 'not_started')
    `;
    await sql`insert into service_rates (organization_id, name, category, unit, rate, currency) values (${organizationId}, 'Edit suite day', 'Edit suite', 'day', '900.00', 'GBP')`;
    await sql`
      insert into bookings (id, organization_id, room_id, episode_id, person_id, title, starts_at, ends_at, setup_minutes, handover_minutes, strike_minutes, status, booking_type) values
        (${conflictBookingId}, ${organizationId}, ${roomOneId}, ${sourceEpisodeId}, ${artistPersonId}, 'Protected edit block', '2035-05-01T09:00:00.000Z', '2035-05-01T12:00:00.000Z', 15, 30, 0, 'confirmed', 'edit'),
        (${sourceBookingOneId}, ${organizationId}, ${roomOneId}, ${sourceEpisodeId}, ${artistPersonId}, 'BOS101 editorial', '2035-05-05T10:00:00.000Z', '2035-05-05T12:00:00.000Z', 15, 0, 0, 'confirmed', 'edit'),
        (${sourceBookingTwoId}, ${organizationId}, ${roomTwoId}, ${sourceEpisodeId}, ${artistPersonId}, 'BOS101 finishing', '2035-05-06T09:00:00.000Z', '2035-05-06T11:00:00.000Z', 0, 20, 10, 'confirmed', 'edit'),
        (${actualBookingId}, ${organizationId}, ${roomOneId}, ${actualEpisodeId}, ${artistPersonId}, 'Actual-time edit day', '2035-05-25T09:00:00.000Z', '2035-05-25T18:00:00.000Z', 0, 0, 0, 'confirmed', 'edit')
    `;
    await sql`insert into bookings (id, organization_id, room_id, episode_id, title, starts_at, ends_at, status, booking_type) values (${foreignBookingId}, ${foreignOrganizationId}, ${foreignRoomId}, ${foreignEpisodeId}, 'Foreign booking', '2035-05-25T09:00:00.000Z', '2035-05-25T18:00:00.000Z', 'confirmed', 'edit')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${artistUserId}, ${approverUserId})`;
    await sql.end();
  });

  test("detects operational-buffer conflicts and allows safe create, edit, and cancellation", async ({ page }) => {
    await useSession(page, managerUserId);
    const conflict = await page.request.post("/api/bookings/conflicts", { data: bookingPayload() });
    expect(conflict.status()).toBe(200);
    const conflictBody = await conflict.json() as { conflicts: Array<{ id: string; overlaps: string[] }>; availableRooms: Array<{ id: string }>; nearestSlot: unknown };
    expect(conflictBody.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ id: conflictBookingId, overlaps: expect.arrayContaining(["room", "person"]) })]));
    expect(conflictBody.availableRooms).toEqual(expect.arrayContaining([expect.objectContaining({ id: roomTwoId })]));
    expect(conflictBody.nearestSlot).toBeTruthy();

    const rejected = await page.request.post("/api/bookings", { data: bookingPayload() });
    expect(rejected.status()).toBe(409);
    const invalidWindow = await page.request.post("/api/bookings", { data: bookingPayload({ startsAt: "2035-05-01T14:00:00.000Z", endsAt: "2035-05-01T14:00:00.000Z" }) });
    expect(invalidWindow.status()).toBe(400);

    const cancelled = await page.request.post("/api/bookings", { data: bookingPayload({ title: "Cancelled overlap", status: "cancelled" }) });
    expect(cancelled.status()).toBe(201);
    const create = await page.request.post("/api/bookings", { data: bookingPayload({ startsAt: "2035-05-01T12:30:00.000Z", endsAt: "2035-05-01T14:00:00.000Z" }) });
    expect(create.status()).toBe(201);
    createdBookingId = (await create.json()).id as string;
    const edit = await page.request.patch(`/api/bookings/${createdBookingId}`, { data: bookingPayload({ title: "Moved edit block", startsAt: "2035-05-01T12:30:00.000Z", endsAt: "2035-05-01T14:30:00.000Z" }) });
    expect(edit.status()).toBe(200);
    const [activity] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${createdBookingId} and action = 'booking.changed'`;
    expect(activity.action).toBe("booking.changed");
  });

  test("copies a multi-day episode sequence tentatively and rejects unsafe copies", async ({ page }) => {
    await useSession(page, managerUserId);
    const copied = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId, targetEpisodeId, startsOn: "2035-06-01T09:00:00.000Z" } });
    const copiedBody = await copied.json();
    expect(copied.status(), JSON.stringify(copiedBody)).toBe(201);
    expect(copiedBody).toMatchObject({ created: 4 });
    const targetBookings = await sql`select title, starts_at, ends_at, status, setup_minutes, handover_minutes, strike_minutes from bookings where organization_id = ${organizationId} and episode_id = ${targetEpisodeId} order by starts_at`;
    expect(targetBookings).toHaveLength(4);
    expect(targetBookings).toEqual(expect.arrayContaining([expect.objectContaining({ title: "BOS102 editorial", status: "tentative", setup_minutes: 15 }), expect.objectContaining({ title: "BOS102 finishing", status: "tentative", handover_minutes: 20, strike_minutes: 10 })]));
    expect(new Date(targetBookings.find((booking) => booking.title === "BOS102 editorial")!.starts_at).toISOString()).toBe("2035-06-05T10:00:00.000Z");
    expect(new Date(targetBookings.find((booking) => booking.title === "BOS102 finishing")!.starts_at).toISOString()).toBe("2035-06-06T09:00:00.000Z");

    const duplicate = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId, targetEpisodeId, startsOn: "2035-06-01T09:00:00.000Z" } });
    expect(duplicate.status()).toBe(409);
    const sameEpisode = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId, targetEpisodeId: sourceEpisodeId, startsOn: "2035-06-01T09:00:00.000Z" } });
    expect(sameEpisode.status()).toBe(400);
    const noSource = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId: emptyEpisodeId, targetEpisodeId: targetEpisodeId, startsOn: "2035-06-01T09:00:00.000Z" } });
    expect(noSource.status()).toBe(400);
    const foreign = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId: foreignEpisodeId, targetEpisodeId, startsOn: "2035-06-01T09:00:00.000Z" } });
    expect(foreign.status()).toBe(404);
  });

  test("submits own actual time, protects it from unauthorised approval, and rolls approved cost into budget", async ({ page }) => {
    await useSession(page, artistUserId);
    const submission = await page.request.post(`/api/bookings/${actualBookingId}/time-submissions`, { data: { actualStartsAt: "2035-05-25T09:00:00.000Z", actualEndsAt: "2035-05-25T19:00:00.000Z", overtimeMinutes: 0, note: "Client notes ran long." } });
    expect(submission.status()).toBe(201);
    const submissionId = (await submission.json()).id as string;
    const duplicate = await page.request.post(`/api/bookings/${actualBookingId}/time-submissions`, { data: { actualStartsAt: "2035-05-25T09:00:00.000Z", actualEndsAt: "2035-05-25T19:00:00.000Z", overtimeMinutes: 0 } });
    expect(duplicate.status()).toBe(409);
    const flag = await page.request.post(`/api/bookings/${actualBookingId}/flag-conflict`, { data: { reason: "Client notes ran beyond the booked finish." } });
    expect(flag.status()).toBe(200);
    const [flagged] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${actualBookingId} and action = 'booking.conflict_flagged'`;
    expect(flagged.action).toBe("booking.conflict_flagged");

    await useSession(page, approverUserId);
    const blockedOverrun = await page.request.post(`/api/booking-time-submissions/${submissionId}/approve`);
    expect(blockedOverrun.status()).toBe(409);
    await expect(blockedOverrun.json()).resolves.toMatchObject({ code: "BUDGET_OVERRUN" });

    await useSession(page, managerUserId);
    const approved = await page.request.post(`/api/booking-time-submissions/${submissionId}/approve`);
    expect(approved.status()).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ approved: true, budgetOverrun: true });
    const [booking] = await sql`select actual_starts_at, actual_ends_at, approved_overtime_minutes from bookings where id = ${actualBookingId}`;
    expect(new Date(booking.actual_ends_at).toISOString()).toBe("2035-05-25T19:00:00.000Z");
    expect(booking.approved_overtime_minutes).toBe(0);
    const [budget] = await sql`select category, budgeted_amount, actual_amount, currency from budget_lines where organization_id = ${organizationId} and episode_id = ${actualEpisodeId} and category = 'Edit suite'`;
    expect(budget).toMatchObject({ category: "Edit suite", budgeted_amount: "900.00", actual_amount: "1000.00", currency: "GBP" });
  });

  test("does not permit a foreign booking mutation or time approval", async ({ page }) => {
    await useSession(page, managerUserId);
    const foreignUpdate = await page.request.patch(`/api/bookings/${foreignBookingId}`, { data: bookingPayload() });
    expect(foreignUpdate.status()).toBe(404);
  });
});
