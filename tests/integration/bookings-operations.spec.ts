import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for booking operations tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "97000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "97000000-0000-4000-8000-000000000002";
const managerUserId = "user_booking_operations_manager";
const artistUserId = "user_booking_operations_artist";
const unassignedUserId = "user_booking_operations_unassigned";
const coloristUserId = "user_booking_operations_colorist";
const guestUserId = "user_booking_operations_guest";
const managerPersonId = "97000000-0000-4000-8000-000000000003";
const artistPersonId = "97000000-0000-4000-8000-000000000004";
const unassignedPersonId = "97000000-0000-4000-8000-000000000026";
const coloristPersonId = "97000000-0000-4000-8000-000000000027";
const guestPersonId = "97000000-0000-4000-8000-000000000028";
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
const optionEpisodeId = "97000000-0000-4000-8000-000000000023";
const workOrderId = "97000000-0000-4000-8000-000000000024";
const conflictingWorkOrderId = "97000000-0000-4000-8000-000000000025";
const unassignedWorkOrderId = "97000000-0000-4000-8000-000000000033";
const roleWorkOrderId = "97000000-0000-4000-8000-000000000034";
const externalWorkOrderId = "97000000-0000-4000-8000-000000000035";
const rebookingWorkOrderId = "97000000-0000-4000-8000-000000000036";
const managerWorkOrderId = "97000000-0000-4000-8000-000000000037";
const raceWorkOrderId = "97000000-0000-4000-8000-000000000038";
const optionWorkOrderId = "97000000-0000-4000-8000-000000000039";
const foreignWorkOrderId = "97000000-0000-4000-8000-000000000040";
const foreignRoomWorkOrderId = "97000000-0000-4000-8000-000000000041";
const statusWorkOrderIds = {
  open: "97000000-0000-4000-8000-000000000042", awaiting_approval: "97000000-0000-4000-8000-000000000043",
  ready_for_review: "97000000-0000-4000-8000-000000000044", complete: "97000000-0000-4000-8000-000000000045", cancelled: "97000000-0000-4000-8000-000000000046",
};
const colorRoomId = "97000000-0000-4000-8000-000000000047";
const mixRoomId = "97000000-0000-4000-8000-000000000048";
const qcRoomId = "97000000-0000-4000-8000-000000000049";
const officeRoomId = "97000000-0000-4000-8000-000000000050";
const mappedWorkOrderIds = { edit: "97000000-0000-4000-8000-000000000051", color: "97000000-0000-4000-8000-000000000052", mix: "97000000-0000-4000-8000-000000000053", qc: "97000000-0000-4000-8000-000000000054" };

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
    status: "confirmed",
    bookingType: "edit",
    notes: null,
    ...overrides,
  };
}

function reservePayload(roomId: string, startsAt: string, endsAt: string) {
  return { roomId, startsAt, endsAt, notes: "Reserved from integration test." };
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
        (${unassignedUserId}, 'Booking Operations Unassigned', 'booking-operations-unassigned@postpilot.test'),
        (${coloristUserId}, 'Booking Operations Colourist', 'booking-operations-colourist@postpilot.test'),
        (${guestUserId}, 'Booking Operations Guest', 'booking-operations-guest@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`insert into organizations (id, name, slug, currency) values (${organizationId}, 'Booking Operations Lab', 'booking-operations-lab', 'GBP'), (${foreignOrganizationId}, 'Foreign Booking Operations', 'foreign-booking-operations', 'GBP')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, ${managerUserId}, 'admin'), (${organizationId}, ${artistUserId}, 'member'), (${organizationId}, ${unassignedUserId}, 'member'), (${organizationId}, ${coloristUserId}, 'member'), (${organizationId}, ${guestUserId}, 'client')`;
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions) values
        (${organizationId}, 'editor', 'Editor', '["update_assigned_work"]'::jsonb),
        (${organizationId}, 'colorist', 'Colourist', '["update_assigned_work"]'::jsonb)
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role) values
        (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Booking Operations Manager', 'booking-operations-manager@postpilot.test', 'producer'),
        (${artistPersonId}, ${organizationId}, ${artistUserId}, 'Booking Operations Artist', 'booking-operations-artist@postpilot.test', 'editor'),
        (${unassignedPersonId}, ${organizationId}, ${unassignedUserId}, 'Booking Operations Unassigned', 'booking-operations-unassigned@postpilot.test', 'editor'),
        (${coloristPersonId}, ${organizationId}, ${coloristUserId}, 'Booking Operations Colourist', 'booking-operations-colourist@postpilot.test', 'colorist'),
        (${guestPersonId}, ${organizationId}, ${guestUserId}, 'Booking Operations Guest', 'booking-operations-guest@postpilot.test', 'client')
    `;
    await sql`insert into rooms (id, organization_id, name, type) values (${roomOneId}, ${organizationId}, 'Operations Edit 1', 'edit_bay'), (${roomTwoId}, ${organizationId}, 'Operations Edit 2', 'edit_bay'), (${colorRoomId}, ${organizationId}, 'Operations Colour', 'color_suite'), (${mixRoomId}, ${organizationId}, 'Operations Mix', 'mix_room'), (${qcRoomId}, ${organizationId}, 'Operations QC', 'qc_room'), (${officeRoomId}, ${organizationId}, 'Operations Office', 'office')`;
    await sql`insert into rooms (id, organization_id, name, type) values (${foreignRoomId}, ${foreignOrganizationId}, 'Foreign Edit 1', 'edit_bay')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Booking Operations Series', 'BOS', 'Europe/London'), (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Booking Series', 'FBS', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1), (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`
      insert into episodes (id, organization_id, season_id, number, production_code, title, status, qc_status) values
        (${sourceEpisodeId}, ${organizationId}, ${seasonId}, 1, 'BOS101', 'Source episode', 'assembly', 'not_started'),
        (${targetEpisodeId}, ${organizationId}, ${seasonId}, 2, 'BOS102', 'Target episode', 'assembly', 'not_started'),
        (${emptyEpisodeId}, ${organizationId}, ${seasonId}, 3, 'BOS103', 'Empty episode', 'assembly', 'not_started'),
        (${actualEpisodeId}, ${organizationId}, ${seasonId}, 4, 'BOS104', 'Actual-time episode', 'assembly', 'not_started'),
        (${optionEpisodeId}, ${organizationId}, ${seasonId}, 5, 'BOS105', 'Option-booking episode', 'assembly', 'not_started'),
        (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'FBS101', 'Foreign episode', 'assembly', 'not_started')
    `;
    await sql`insert into service_rates (organization_id, name, category, unit, rate, currency) values (${organizationId}, 'Edit suite day', 'Edit suite', 'day', '900.00', 'GBP')`;
    await sql`
      insert into bookings (id, organization_id, room_id, episode_id, person_id, title, starts_at, ends_at, setup_minutes, handover_minutes, status, booking_type) values
        (${conflictBookingId}, ${organizationId}, ${roomOneId}, ${sourceEpisodeId}, ${artistPersonId}, 'Protected edit block', '2035-05-01T09:00:00.000Z', '2035-05-01T12:00:00.000Z', 15, 30, 'confirmed', 'edit'),
        (${sourceBookingOneId}, ${organizationId}, ${roomOneId}, ${sourceEpisodeId}, ${artistPersonId}, 'BOS101 editorial', '2035-05-05T10:00:00.000Z', '2035-05-05T12:00:00.000Z', 15, 0, 'confirmed', 'edit'),
        (${sourceBookingTwoId}, ${organizationId}, ${roomTwoId}, ${sourceEpisodeId}, ${artistPersonId}, 'BOS101 finishing', '2035-05-06T09:00:00.000Z', '2035-05-06T11:00:00.000Z', 0, 20, 'confirmed', 'edit'),
        (${actualBookingId}, ${organizationId}, ${roomOneId}, ${actualEpisodeId}, ${artistPersonId}, 'Actual-time edit day', '2035-05-25T09:00:00.000Z', '2035-05-25T18:00:00.000Z', 0, 0, 'confirmed', 'edit')
    `;
    await sql`insert into bookings (id, organization_id, room_id, episode_id, title, starts_at, ends_at, status, booking_type) values (${foreignBookingId}, ${foreignOrganizationId}, ${foreignRoomId}, ${foreignEpisodeId}, 'Foreign booking', '2035-05-25T09:00:00.000Z', '2035-05-25T18:00:00.000Z', 'confirmed', 'edit')`;
    await sql`
      insert into post_work_orders (id, organization_id, episode_id, assignee_person_id, title, status, work_type, billing_scope, currency) values
        (${workOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Colour cleanup pass', 'in_progress', 'internal', 'included', 'GBP'),
        (${conflictingWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Second colour cleanup pass', 'in_progress', 'internal', 'included', 'GBP'),
        (${unassignedWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${managerPersonId}, 'Producer-only work', 'in_progress', 'internal', 'included', 'GBP'),
        (${roleWorkOrderId}, ${organizationId}, ${optionEpisodeId}, null, 'Role-assigned grade', 'in_progress', 'internal', 'included', 'GBP'),
        (${externalWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Vendor grade', 'in_progress', 'external_vendor', 'internal', 'GBP'),
        (${rebookingWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Replacement grade slot', 'in_progress', 'internal', 'included', 'GBP'),
        (${managerWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Manager scheduled artist work', 'in_progress', 'internal', 'included', 'GBP'),
        (${raceWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Concurrent reserve test', 'in_progress', 'internal', 'included', 'GBP'),
        (${optionWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Option-safe reserve', 'in_progress', 'internal', 'included', 'GBP'),
        (${foreignRoomWorkOrderId}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Foreign room rejection', 'in_progress', 'internal', 'included', 'GBP'),
        (${mappedWorkOrderIds.edit}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Edit mapping', 'in_progress', 'internal', 'included', 'GBP'),
        (${mappedWorkOrderIds.color}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Colour mapping', 'in_progress', 'internal', 'included', 'GBP'),
        (${mappedWorkOrderIds.mix}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Mix mapping', 'in_progress', 'internal', 'included', 'GBP'),
        (${mappedWorkOrderIds.qc}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'QC mapping', 'in_progress', 'internal', 'included', 'GBP'),
        (${statusWorkOrderIds.open}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Open work', 'open', 'internal', 'included', 'GBP'),
        (${statusWorkOrderIds.awaiting_approval}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Pending work', 'awaiting_approval', 'internal', 'included', 'GBP'),
        (${statusWorkOrderIds.ready_for_review}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Review work', 'ready_for_review', 'internal', 'included', 'GBP'),
        (${statusWorkOrderIds.complete}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Complete work', 'complete', 'internal', 'included', 'GBP'),
        (${statusWorkOrderIds.cancelled}, ${organizationId}, ${optionEpisodeId}, ${artistPersonId}, 'Cancelled work', 'cancelled', 'internal', 'included', 'GBP'),
        (${foreignWorkOrderId}, ${foreignOrganizationId}, ${foreignEpisodeId}, null, 'Foreign work order', 'in_progress', 'internal', 'included', 'GBP')
    `;
    await sql`update post_work_orders set assignee_role = 'colorist' where id = ${roleWorkOrderId}`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${artistUserId}, ${unassignedUserId}, ${coloristUserId}, ${guestUserId})`;
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

  test("supports numbered option bookings without blocking a confirmed booking", async ({ page }) => {
    await useSession(page, managerUserId);
    const optionWindow = { episodeId: optionEpisodeId, startsAt: "2035-05-10T09:00:00.000Z", endsAt: "2035-05-10T13:00:00.000Z", status: "tentative", isOption: true };
    const first = await page.request.post("/api/bookings", { data: bookingPayload({ ...optionWindow, title: "First pencil hold" }) });
    expect(first.status()).toBe(201);
    const firstBookingId = (await first.json()).id as string;
    const second = await page.request.post("/api/bookings", { data: bookingPayload({ ...optionWindow, title: "Second pencil hold" }) });
    expect(second.status()).toBe(201);
    const secondBookingId = (await second.json()).id as string;
    const holds = await sql`select id, is_option, option_rank, status from bookings where id in (${firstBookingId}, ${secondBookingId}) order by option_rank`;
    expect(holds).toEqual([
      expect.objectContaining({ id: firstBookingId, is_option: true, option_rank: 1, status: "tentative" }),
      expect.objectContaining({ id: secondBookingId, is_option: true, option_rank: 2, status: "tentative" }),
    ]);

    const confirmed = await page.request.post("/api/bookings", { data: bookingPayload({ ...optionWindow, title: "Confirmed client booking", status: "confirmed", isOption: false }) });
    expect(confirmed.status()).toBe(201);

    const withdraw = await page.request.patch(`/api/bookings/${firstBookingId}`, { data: bookingPayload({ ...optionWindow, title: "First pencil hold", status: "cancelled", isOption: true }) });
    expect(withdraw.status()).toBe(200);
    const [remaining] = await sql`select option_rank from bookings where id = ${secondBookingId}`;
    expect(remaining.option_rank).toBe(1);
  });

  test("copies a multi-day episode sequence tentatively and rejects unsafe copies", async ({ page }) => {
    await useSession(page, managerUserId);
    const copied = await page.request.post("/api/bookings/copy-episode", { data: { sourceEpisodeId, targetEpisodeId, startsOn: "2035-06-01T09:00:00.000Z" } });
    const copiedBody = await copied.json();
    expect(copied.status(), JSON.stringify(copiedBody)).toBe(201);
    expect(copiedBody).toMatchObject({ created: 4 });
    const targetBookings = await sql`select title, starts_at, ends_at, status, setup_minutes, handover_minutes from bookings where organization_id = ${organizationId} and episode_id = ${targetEpisodeId} order by starts_at`;
    expect(targetBookings).toHaveLength(4);
    expect(targetBookings).toEqual(expect.arrayContaining([expect.objectContaining({ title: "BOS102 editorial", status: "tentative", setup_minutes: 15 }), expect.objectContaining({ title: "BOS102 finishing", status: "tentative", handover_minutes: 20 })]));
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

  test("confirms own actual time and rolls its cost into budget immediately", async ({ page }) => {
    await useSession(page, artistUserId);
    const submission = await page.request.post(`/api/bookings/${actualBookingId}/time-submissions`, { data: { actualStartsAt: "2035-05-25T09:00:00.000Z", actualEndsAt: "2035-05-25T19:00:00.000Z", overtimeMinutes: 0, note: "Client notes ran long." } });
    expect(submission.status()).toBe(201);
    await expect(submission.json()).resolves.toMatchObject({ confirmed: true, budgetOverrun: true });
    const duplicate = await page.request.post(`/api/bookings/${actualBookingId}/time-submissions`, { data: { actualStartsAt: "2035-05-25T09:00:00.000Z", actualEndsAt: "2035-05-25T19:00:00.000Z", overtimeMinutes: 0 } });
    expect(duplicate.status()).toBe(409);
    const flag = await page.request.post(`/api/bookings/${actualBookingId}/flag-conflict`, { data: { reason: "Client notes ran beyond the booked finish." } });
    expect(flag.status()).toBe(200);
    const [flagged] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${actualBookingId} and action = 'booking.conflict_flagged'`;
    expect(flagged.action).toBe("booking.conflict_flagged");

    const [booking] = await sql`select actual_starts_at, actual_ends_at, approved_overtime_minutes from bookings where id = ${actualBookingId}`;
    expect(new Date(booking.actual_ends_at).toISOString()).toBe("2035-05-25T19:00:00.000Z");
    expect(booking.approved_overtime_minutes).toBe(0);
    const [budget] = await sql`select category, budgeted_amount, actual_amount, currency from budget_lines where organization_id = ${organizationId} and episode_id = ${actualEpisodeId} and category = 'Edit suite'`;
    expect(budget).toMatchObject({ category: "Edit suite", budgeted_amount: "900.00", actual_amount: "1000.00", currency: "GBP" });
  });

  test("lets an assigned artist reserve a room from internal work and links actual time", async ({ page }) => {
    await useSession(page, artistUserId);
    const reserve = await page.request.post(`/api/work-orders/${workOrderId}/booking`, { data: { roomId: roomTwoId, startsAt: "2035-05-30T14:00:00.000Z", endsAt: "2035-05-30T16:00:00.000Z", notes: "Quick client adjustment." } });
    expect(reserve.status()).toBe(201);
    const reserved = await reserve.json() as { id: string; workOrderId: string };
    expect(reserved.workOrderId).toBe(workOrderId);
    const [linked] = await sql`select booking_id from post_work_orders where id = ${workOrderId}`;
    expect(linked.booking_id).toBe(reserved.id);
    const [createdBooking] = await sql`select organization_id, episode_id, person_id, room_id, status, booking_type, is_option, notes from bookings where id = ${reserved.id}`;
    expect(createdBooking).toMatchObject({ organization_id: organizationId, episode_id: optionEpisodeId, person_id: artistPersonId, room_id: roomTwoId, status: "confirmed", booking_type: "edit", is_option: false, notes: "Quick client adjustment." });
    const scheduledActions = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id in (${workOrderId}, ${reserved.id}) order by action`;
    expect(scheduledActions.map((entry) => entry.action)).toEqual(expect.arrayContaining(["booking.created_from_work_order", "work_order.booking_scheduled"]));
    const duplicate = await page.request.post(`/api/work-orders/${workOrderId}/booking`, { data: { roomId: roomTwoId, startsAt: "2035-05-30T14:00:00.000Z", endsAt: "2035-05-30T16:00:00.000Z" } });
    expect(duplicate.status()).toBe(409);
    const conflict = await page.request.post(`/api/work-orders/${conflictingWorkOrderId}/booking`, { data: { roomId: roomTwoId, startsAt: "2035-05-30T14:00:00.000Z", endsAt: "2035-05-30T16:00:00.000Z" } });
    expect(conflict.status()).toBe(409);
    const actual = await page.request.post(`/api/bookings/${reserved.id}/time-submissions`, { data: { actualStartsAt: "2035-05-30T14:00:00.000Z", actualEndsAt: "2035-05-30T16:15:00.000Z", overtimeMinutes: 15, note: "Completed colour adjustment." } });
    expect(actual.status()).toBe(201);
    await expect(actual.json()).resolves.toMatchObject({ confirmed: true, workOrderId });
    const [logged] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${workOrderId} and action = 'work_order.time_logged'`;
    expect(logged.action).toBe("work_order.time_logged");
  });

  test("enforces work-order lifecycle, work type, assignment, and tenant boundaries", async ({ page }) => {
    await useSession(page, artistUserId);
    for (const [status, id] of Object.entries(statusWorkOrderIds)) {
      const response = await page.request.post(`/api/work-orders/${id}/booking`, { data: reservePayload(roomTwoId, `2035-06-10T${String(9 + Object.keys(statusWorkOrderIds).indexOf(status)).padStart(2, "0")}:00:00.000Z`, `2035-06-10T${String(10 + Object.keys(statusWorkOrderIds).indexOf(status)).padStart(2, "0")}:00:00.000Z`) });
      expect(response.status(), status).toBe(409);
    }
    expect((await page.request.post(`/api/work-orders/${externalWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-11T09:00:00.000Z", "2035-06-11T10:00:00.000Z") })).status()).toBe(409);
    expect((await page.request.post(`/api/work-orders/${unassignedWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-11T11:00:00.000Z", "2035-06-11T12:00:00.000Z") })).status()).toBe(403);
    expect((await page.request.post(`/api/work-orders/${foreignWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-11T13:00:00.000Z", "2035-06-11T14:00:00.000Z") })).status()).toBe(404);
    expect((await page.request.post(`/api/work-orders/${foreignRoomWorkOrderId}/booking`, { data: reservePayload(foreignRoomId, "2035-06-11T15:00:00.000Z", "2035-06-11T16:00:00.000Z") })).status()).toBe(404);
    expect((await page.request.post(`/api/work-orders/${foreignRoomWorkOrderId}/booking`, { data: { roomId: roomTwoId, startsAt: "not-a-date", endsAt: "2035-06-11T16:00:00.000Z" } })).status()).toBe(400);

    await useSession(page, guestUserId);
    expect((await page.request.post(`/api/work-orders/${foreignRoomWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-11T15:00:00.000Z", "2035-06-11T16:00:00.000Z") })).status()).toBe(403);
  });

  test("uses the assigned person for manager and role-assigned reservations", async ({ page }) => {
    await useSession(page, managerUserId);
    const managerReservation = await page.request.post(`/api/work-orders/${managerWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-12T09:00:00.000Z", "2035-06-12T10:00:00.000Z") });
    expect(managerReservation.status()).toBe(201);
    const managerBooking = await managerReservation.json() as { id: string };
    const [managerAssigned] = await sql`select person_id from bookings where id = ${managerBooking.id}`;
    expect(managerAssigned.person_id).toBe(artistPersonId);

    await useSession(page, coloristUserId);
    const roleReservation = await page.request.post(`/api/work-orders/${roleWorkOrderId}/booking`, { data: reservePayload(colorRoomId, "2035-06-12T11:00:00.000Z", "2035-06-12T12:00:00.000Z") });
    expect(roleReservation.status()).toBe(201);
    const roleBooking = await roleReservation.json() as { id: string };
    const [roleAssigned] = await sql`select person_id, booking_type from bookings where id = ${roleBooking.id}`;
    expect(roleAssigned).toMatchObject({ person_id: coloristPersonId, booking_type: "color" });
  });

  test("maps supported room types and keeps pencil holds non-blocking", async ({ page }) => {
    await useSession(page, artistUserId);
    const mappings: Array<[string, string, string]> = [[mappedWorkOrderIds.edit, roomTwoId, "edit"], [mappedWorkOrderIds.color, colorRoomId, "color"], [mappedWorkOrderIds.mix, mixRoomId, "mix"], [mappedWorkOrderIds.qc, qcRoomId, "qc"]];
    for (const [id, roomId, expectedType] of mappings) {
      const hour = 9 + mappings.findIndex(([workOrderId]) => workOrderId === id) * 2;
      const result = await page.request.post(`/api/work-orders/${id}/booking`, { data: reservePayload(roomId, `2035-06-13T${String(hour).padStart(2, "0")}:00:00.000Z`, `2035-06-13T${String(hour + 1).padStart(2, "0")}:00:00.000Z`) });
      expect(result.status()).toBe(201);
      const reservation = await result.json() as { id: string };
      const [booking] = await sql`select booking_type from bookings where id = ${reservation.id}`;
      expect(booking.booking_type).toBe(expectedType);
    }
    expect((await page.request.post(`/api/work-orders/${foreignRoomWorkOrderId}/booking`, { data: reservePayload(officeRoomId, "2035-06-14T09:00:00.000Z", "2035-06-14T10:00:00.000Z") })).status()).toBe(400);
    await useSession(page, managerUserId);
    const option = await page.request.post("/api/bookings", { data: bookingPayload({ title: "Work-order pencil hold", roomId: roomOneId, episodeId: optionEpisodeId, personId: artistPersonId, startsAt: "2035-06-17T09:00:00.000Z", endsAt: "2035-06-17T13:00:00.000Z", status: "tentative", isOption: true }) });
    expect(option.status()).toBe(201);
    await useSession(page, artistUserId);
    const optionSafe = await page.request.post(`/api/work-orders/${optionWorkOrderId}/booking`, { data: reservePayload(roomOneId, "2035-06-17T09:00:00.000Z", "2035-06-17T13:00:00.000Z") });
    expect(optionSafe.status()).toBe(201);
  });

  test("allows a cancelled linked booking to be replaced", async ({ page }) => {
    await useSession(page, artistUserId);
    const first = await page.request.post(`/api/work-orders/${rebookingWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-15T09:00:00.000Z", "2035-06-15T11:00:00.000Z") });
    expect(first.status()).toBe(201);
    const firstBooking = await first.json() as { id: string };
    await useSession(page, managerUserId);
    const cancelled = await page.request.patch(`/api/bookings/${firstBooking.id}`, { data: bookingPayload({ title: "Cancelled replacement slot", roomId: roomTwoId, episodeId: optionEpisodeId, personId: artistPersonId, startsAt: "2035-06-15T09:00:00.000Z", endsAt: "2035-06-15T11:00:00.000Z", status: "cancelled" }) });
    expect(cancelled.status()).toBe(200);
    await useSession(page, artistUserId);
    const replacement = await page.request.post(`/api/work-orders/${rebookingWorkOrderId}/booking`, { data: reservePayload(roomTwoId, "2035-06-15T12:00:00.000Z", "2035-06-15T14:00:00.000Z") });
    expect(replacement.status()).toBe(201);
    const replacementBooking = await replacement.json() as { id: string };
    expect(replacementBooking.id).not.toBe(firstBooking.id);
  });

  test("creates exactly one linked booking under concurrent reserve attempts", async ({ page }) => {
    await useSession(page, artistUserId);
    const payload = reservePayload(roomTwoId, "2035-06-16T09:00:00.000Z", "2035-06-16T11:00:00.000Z");
    const [first, second] = await Promise.all([page.request.post(`/api/work-orders/${raceWorkOrderId}/booking`, { data: payload }), page.request.post(`/api/work-orders/${raceWorkOrderId}/booking`, { data: payload })]);
    expect([first.status(), second.status()].sort()).toEqual([201, 409]);
    const rows = await sql`select id from bookings where organization_id = ${organizationId} and title = 'Work order · Concurrent reserve test'`;
    expect(rows).toHaveLength(1);
    const [workOrder] = await sql`select booking_id from post_work_orders where id = ${raceWorkOrderId}`;
    expect(workOrder.booking_id).toBe(rows[0].id);
  });

  test("shows artists a usable, conflict-aware work-order reservation UI and keeps guests out", async ({ page }) => {
    await useSession(page, artistUserId);
    await page.goto("/bookings");
    await expect(page.getByText("Ready to schedule", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reserve work order Vendor grade" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reserve work order Open work" })).toHaveCount(0);

    const dragCard = page.getByRole("button", { name: "Reserve work order Foreign room rejection" });
    await dragCard.dragTo(page.getByTestId(`room-timeline-${roomTwoId}`));
    await expect(page.getByRole("heading", { name: "Foreign room rejection" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Suite / room" })).toHaveValue(roomTwoId);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    const day = new Date();
    const start = localDateTime(day, 9); const end = localDateTime(day, 11);
    await useSession(page, managerUserId);
    const occupied = await page.request.post("/api/bookings", { data: bookingPayload({ title: "UI reservation conflict", roomId: roomTwoId, episodeId: optionEpisodeId, personId: artistPersonId, startsAt: `${start}:00.000Z`, endsAt: `${end}:00.000Z` }) });
    expect(occupied.status()).toBe(201);
    await useSession(page, artistUserId);
    await page.goto("/bookings");
    await page.getByRole("button", { name: "Reserve work order Second colour cleanup pass" }).click();
    await page.getByRole("combobox", { name: "Suite / room" }).selectOption(roomTwoId);
    await page.locator('input[type="datetime-local"]').nth(0).fill(start);
    await page.locator('input[type="datetime-local"]').nth(1).fill(end);
    await page.getByRole("button", { name: "Reserve room", exact: true }).click();
    await expect(page.locator("p[role='alert']")).toContainText("already booked");

    await useSession(page, guestUserId);
    await page.goto("/bookings");
    await expect(page).toHaveURL(/\/episodes$/);
  });

  test("does not permit a foreign booking mutation", async ({ page }) => {
    await useSession(page, managerUserId);
    const foreignUpdate = await page.request.patch(`/api/bookings/${foreignBookingId}`, { data: bookingPayload() });
    expect(foreignUpdate.status()).toBe(404);
  });
});

function localDateTime(date: Date, hour: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:00`;
}
