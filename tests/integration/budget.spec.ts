import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for budget integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "94000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "94000000-0000-4000-8000-000000000002";
const managerUserId = "user_budget_lab_manager";
const financeUserId = "user_budget_lab_finance";
const rateUserId = "user_budget_lab_rates";
const artistUserId = "user_budget_lab_artist";
const managerPersonId = "94000000-0000-4000-8000-000000000003";
const financePersonId = "94000000-0000-4000-8000-000000000004";
const ratePersonId = "94000000-0000-4000-8000-000000000005";
const artistPersonId = "94000000-0000-4000-8000-000000000006";
const showId = "94000000-0000-4000-8000-000000000007";
const seasonId = "94000000-0000-4000-8000-000000000008";
const episodeId = "94000000-0000-4000-8000-000000000009";
const otherEpisodeId = "94000000-0000-4000-8000-000000000010";
const roomId = "94000000-0000-4000-8000-000000000011";
const bookingId = "94000000-0000-4000-8000-000000000012";
const facilityRateId = "94000000-0000-4000-8000-000000000013";
const sourceWorkOrderId = "94000000-0000-4000-8000-000000000014";
const foreignShowId = "94000000-0000-4000-8000-000000000015";
const foreignSeasonId = "94000000-0000-4000-8000-000000000016";
const foreignEpisodeId = "94000000-0000-4000-8000-000000000017";
const foreignRateId = "94000000-0000-4000-8000-000000000018";
const foreignLineId = "94000000-0000-4000-8000-000000000019";

function linePayload(overrides: Record<string, unknown> = {}) {
  return { episodeId, category: "editor", description: "Editorial support", budgetedAmount: 100, actualAmount: 25, costType: "internal", ...overrides };
}

async function useSession(page: Page, userId: string) {
  const user = await page.request.post("/api/debug/user", { data: { userId } });
  expect(user.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } });
  expect(tenant.status()).toBe(200);
}

test.describe("Budget integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values (${managerUserId}, 'Budget Lab Manager', 'budget-manager@postpilot.test'), (${financeUserId}, 'Budget Lab Finance', 'budget-finance@postpilot.test'), (${rateUserId}, 'Budget Lab Rates', 'budget-rates@postpilot.test'), (${artistUserId}, 'Budget Lab Artist', 'budget-artist@postpilot.test') on conflict (id) do update set name = excluded.name`;
    await sql`insert into organizations (id, name, slug, currency) values (${organizationId}, 'Budget Lab', 'budget-lab', 'GBP'), (${foreignOrganizationId}, 'Foreign Budget Lab', 'foreign-budget-lab', 'GBP')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, ${managerUserId}, 'admin'), (${organizationId}, ${financeUserId}, 'member'), (${organizationId}, ${rateUserId}, 'member'), (${organizationId}, ${artistUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values (${organizationId}, 'finance', 'Finance', '["manage_budget"]'::jsonb), (${organizationId}, 'rate_manager', 'Rate manager', '["manage_rates"]'::jsonb), (${organizationId}, 'editor', 'Editor', '["update_assigned_work"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Budget Lab Manager', 'budget-manager@postpilot.test', 'producer'), (${financePersonId}, ${organizationId}, ${financeUserId}, 'Budget Lab Finance', 'budget-finance@postpilot.test', 'finance'), (${ratePersonId}, ${organizationId}, ${rateUserId}, 'Budget Lab Rates', 'budget-rates@postpilot.test', 'rate_manager'), (${artistPersonId}, ${organizationId}, ${artistUserId}, 'Budget Lab Artist', 'budget-artist@postpilot.test', 'editor')`;
    await sql`insert into rooms (id, organization_id, name, type) values (${roomId}, ${organizationId}, 'Budget Edit 1', 'edit_bay')`;
    await sql`insert into shows (id, organization_id, title, code, network, time_zone) values (${showId}, ${organizationId}, 'Budget Series', 'BUD', 'Budget Network', 'Europe/London'), (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Budget Series', 'FBUD', 'Foreign Network', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1), (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, 1, 'Budget episode', 'assembly', 'not_started'), (${otherEpisodeId}, ${organizationId}, ${seasonId}, 2, 'Other budget episode', 'assembly', 'not_started'), (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'Foreign budget episode', 'assembly', 'not_started')`;
    await sql`insert into bookings (id, organization_id, room_id, episode_id, person_id, title, starts_at, ends_at, status, booking_type) values (${bookingId}, ${organizationId}, ${roomId}, ${episodeId}, ${artistPersonId}, 'Budget edit day', '2035-07-10T09:00:00.000Z', '2035-07-10T18:00:00.000Z', 'confirmed', 'edit')`;
    await sql`insert into service_rates (id, organization_id, name, category, unit, rate, currency) values (${facilityRateId}, ${organizationId}, 'Edit suite day', 'Edit suite', 'day', '100.00', 'GBP'), (${foreignRateId}, ${foreignOrganizationId}, 'Foreign edit suite day', 'Edit suite', 'day', '300.00', 'GBP')`;
    await sql`insert into budget_lines (id, organization_id, show_id, season_id, episode_id, category, budgeted_amount, actual_amount, currency, cost_type) values (${foreignLineId}, ${foreignOrganizationId}, ${foreignShowId}, ${foreignSeasonId}, ${foreignEpisodeId}, 'editor', '100.00', '10.00', 'GBP', 'internal')`;
  });

  test.beforeEach(async () => {
    await sql`delete from activity_log where organization_id = ${organizationId} and entity_type = 'budget_line'`;
    await sql`delete from budget_lines where organization_id = ${organizationId}`;
    await sql`delete from post_work_orders where organization_id = ${organizationId}`;
    await sql`delete from rate_cards where organization_id = ${organizationId}`;
    await sql`delete from service_rates where organization_id = ${organizationId} and id <> ${facilityRateId}`;
    await sql`update service_rates set rate = '100.00', is_active = true where organization_id = ${organizationId} and id = ${facilityRateId}`;
    await sql`update bookings set actual_starts_at = null, actual_ends_at = null, approved_overtime_minutes = 0 where id = ${bookingId}`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${financeUserId}, ${rateUserId}, ${artistUserId})`;
    await sql.end();
  });

  test("creates, edits, and deletes a tenant-scoped manual episode budget line", async ({ page }) => {
    await useSession(page, financeUserId);
    const create = await page.request.post("/api/budget-lines", { data: linePayload() });
    expect(create.status()).toBe(201);
    const lineId = (await create.json()).id as string;
    const [created] = await sql`select organization_id, show_id, season_id, episode_id, budgeted_amount, actual_amount, currency from budget_lines where id = ${lineId}`;
    expect(created).toMatchObject({ organization_id: organizationId, show_id: showId, season_id: seasonId, episode_id: episodeId, budgeted_amount: "100.00", actual_amount: "25.00", currency: "GBP" });

    const update = await page.request.patch(`/api/budget-lines/${lineId}`, { data: { episodeId: otherEpisodeId, description: "Moved editorial support", budgetedAmount: 120, actualAmount: 45 } });
    expect(update.status()).toBe(200);
    const [updated] = await sql`select episode_id, description, budgeted_amount, actual_amount from budget_lines where id = ${lineId}`;
    expect(updated).toMatchObject({ episode_id: otherEpisodeId, description: "Moved editorial support", budgeted_amount: "120.00", actual_amount: "45.00" });

    const remove = await page.request.delete(`/api/budget-lines/${lineId}`);
    expect(remove.status()).toBe(200);
    const [gone] = await sql`select id from budget_lines where id = ${lineId}`;
    expect(gone).toBeUndefined();
    const events = await sql`select action from activity_log where organization_id = ${organizationId} and entity_type = 'budget_line' order by created_at`;
    expect(events.map((event) => event.action)).toEqual(["budget_line.created", "budget_line.updated", "budget_line.deleted"]);
  });

  test("rejects invalid, foreign, and source-managed budget line mutations", async ({ page }) => {
    await useSession(page, financeUserId);
    expect((await page.request.post("/api/budget-lines", { data: linePayload({ actualAmount: -1 }) })).status()).toBe(400);
    expect((await page.request.post("/api/budget-lines", { data: linePayload({ episodeId: foreignEpisodeId }) })).status()).toBe(404);
    expect((await page.request.patch(`/api/budget-lines/${foreignLineId}`, { data: { actualAmount: 50 } })).status()).toBe(404);
    expect((await page.request.delete(`/api/budget-lines/${foreignLineId}`)).status()).toBe(404);

    await sql`insert into post_work_orders (id, organization_id, episode_id, title) values (${sourceWorkOrderId}, ${organizationId}, ${episodeId}, 'Linked commercial change')`;
    await sql`insert into budget_lines (organization_id, show_id, season_id, episode_id, work_order_id, category, budgeted_amount, actual_amount, currency, cost_type) values (${organizationId}, ${showId}, ${seasonId}, ${episodeId}, ${sourceWorkOrderId}, 'VFX', '100.00', '0.00', 'GBP', 'billable')`;
    const [linked] = await sql`select id from budget_lines where organization_id = ${organizationId} and work_order_id = ${sourceWorkOrderId}`;
    expect((await page.request.patch(`/api/budget-lines/${linked.id}`, { data: { actualAmount: 50 } })).status()).toBe(409);
    expect((await page.request.delete(`/api/budget-lines/${linked.id}`)).status()).toBe(409);
  });

  test("separates finance, rate, and artist permissions", async ({ page }) => {
    await useSession(page, artistUserId);
    expect((await page.request.post("/api/budget-lines", { data: linePayload() })).status()).toBe(403);
    expect((await page.request.post("/api/rate-card-overrides", { data: { scope: { type: "network", network: "Budget Network" }, serviceRateId: facilityRateId, rate: 120 } })).status()).toBe(403);

    await useSession(page, financeUserId);
    expect((await page.request.post("/api/service-rates", { data: { name: "Finance service", category: "Finance", unit: "fixed", rate: 10, isActive: true } })).status()).toBe(201);
    expect((await page.request.post("/api/rate-card-overrides", { data: { scope: { type: "network", network: "Budget Network" }, serviceRateId: facilityRateId, rate: 120 } })).status()).toBe(403);

    await useSession(page, rateUserId);
    expect((await page.request.post("/api/rate-card-overrides", { data: { scope: { type: "network", network: "Budget Network" }, serviceRateId: facilityRateId, rate: 120 } })).status()).toBe(200);
  });

  test("maintains service rates locally and rejects a foreign rate ID", async ({ page }) => {
    await useSession(page, financeUserId);
    const create = await page.request.post("/api/service-rates", { data: { name: "Colourist day", category: "Colour", unit: "day", rate: 650, notes: "Senior finishing", isActive: true } });
    expect(create.status()).toBe(201);
    const rateId = (await create.json()).id as string;
    expect((await page.request.post("/api/service-rates", { data: { name: "Colourist day", category: "Colour", unit: "day", rate: 650, isActive: true } })).status()).toBe(409);
    expect((await page.request.patch(`/api/service-rates/${rateId}`, { data: { rate: 700, isActive: false } })).status()).toBe(200);
    const [rate] = await sql`select rate, is_active, currency from service_rates where id = ${rateId}`;
    expect(rate).toMatchObject({ rate: "700.00", is_active: false, currency: "GBP" });
    expect((await page.request.patch(`/api/service-rates/${foreignRateId}`, { data: { rate: 1 } })).status()).toBe(404);
  });

  test("resolves facility, network, show, and episode rates in precedence order", async ({ page }) => {
    await useSession(page, rateUserId);
    const override = async (scope: Record<string, unknown>, rate: number) => page.request.post("/api/rate-card-overrides", { data: { scope, serviceRateId: facilityRateId, rate } });
    expect((await override({ type: "network", network: "Budget Network" }, 120)).status()).toBe(200);
    const showInherited = await page.request.get(`/api/rate-card-overrides?type=show&showId=${showId}`);
    expect(showInherited.status()).toBe(200);
    expect((await showInherited.json()).inherited["Edit suite:day"]).toMatchObject({ rate: "120.00" });
    expect((await override({ type: "show", showId }, 150)).status()).toBe(200);
    const episodeInherited = await page.request.get(`/api/rate-card-overrides?type=episode&episodeId=${episodeId}`);
    expect((await episodeInherited.json()).inherited["Edit suite:day"]).toMatchObject({ rate: "150.00" });
    expect((await override({ type: "episode", episodeId }, 180)).status()).toBe(200);
    const episodeOverride = await page.request.get(`/api/rate-card-overrides?type=episode&episodeId=${episodeId}`);
    const body = await episodeOverride.json();
    expect(body.overrides["Edit suite:day"]).toMatchObject({ rate: "180.00" });
    expect((await override({ type: "show", showId: foreignShowId }, 200)).status()).toBe(404);
    expect((await override({ type: "network", network: "Budget Network" }, 0)).status()).toBe(400);
  });

  test("uses the effective episode rate for a booking cost roll-up", async ({ page }) => {
    await useSession(page, rateUserId);
    expect((await page.request.post("/api/rate-card-overrides", { data: { scope: { type: "episode", episodeId }, serviceRateId: facilityRateId, rate: 180 } })).status()).toBe(200);
    await useSession(page, artistUserId);
    const actual = await page.request.post(`/api/bookings/${bookingId}/time-submissions`, { data: { actualStartsAt: "2035-07-10T09:00:00.000Z", actualEndsAt: "2035-07-10T18:00:00.000Z", overtimeMinutes: 0 } });
    expect(actual.status()).toBe(201);
    const [line] = await sql`select budgeted_amount, actual_amount, currency from budget_lines where organization_id = ${organizationId} and episode_id = ${episodeId} and category = 'Edit suite'`;
    expect(line).toMatchObject({ budgeted_amount: "180.00", actual_amount: "180.00", currency: "GBP" });
  });

  test("supports the budget drill-down and manual line form in the UI", async ({ page }) => {
    await useSession(page, financeUserId);
    const create = await page.request.post("/api/budget-lines", { data: linePayload({ category: "sound", description: "Initial sound budget", budgetedAmount: 400, actualAmount: 0 }) });
    expect(create.status()).toBe(201);
    await page.goto(`/budget?network=Budget%20Network&show=Budget%20Series&episode=${episodeId}`);
    await expect(page.getByRole("heading", { name: "Budget" })).toBeVisible();
    await expect(page.getByText("Initial sound budget", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add episode budget", exact: true }).click();
    await page.getByRole("button", { name: "Save line", exact: true }).click();
    await expect(page.getByText("Select an episode.", { exact: true })).toBeVisible();
    await page.getByLabel("Episode").selectOption(episodeId);
    await page.getByLabel("Description").fill("UI budget line");
    await page.getByLabel("Estimated cost (GBP)").fill("250");
    await page.getByLabel("Actual cost (GBP)").fill("50");
    await page.getByRole("button", { name: "Save line", exact: true }).click();
    await expect(page.getByText("UI budget line", { exact: true })).toBeVisible();
  });
});
