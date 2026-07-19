import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for management route tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "94700000-0000-4000-8000-000000000001";
const foreignOrganizationId = "94700000-0000-4000-8000-000000000002";
const productionUserId = "management-production-user";
const commercialUserId = "management-commercial-user";
const assignedUserId = "management-assigned-user";
const foreignShowId = "94700000-0000-4000-8000-000000000003";
const foreignCompanyId = "94700000-0000-4000-8000-000000000004";
const foreignRoomId = "94700000-0000-4000-8000-000000000005";
const foreignRateId = "94700000-0000-4000-8000-000000000006";

async function assume(page: Page, userId: string) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/settings/rooms" } })).status()).toBe(200);
}

test.describe("Management endpoint permission and tenant boundaries", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${productionUserId}, ${commercialUserId}, ${assignedUserId})`;
    await sql`insert into users (id, name, email) values
      (${productionUserId}, 'Management Production', 'management-production@postpilot.test'),
      (${commercialUserId}, 'Management Commercial', 'management-commercial@postpilot.test'),
      (${assignedUserId}, 'Management Assigned', 'management-assigned@postpilot.test')`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationId}, 'Management Route Lab', 'management-route-lab'),
      (${foreignOrganizationId}, 'Foreign Management Route Lab', 'foreign-management-route-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${productionUserId}, 'member'),
      (${organizationId}, ${commercialUserId}, 'member'),
      (${organizationId}, ${assignedUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'production_manager', 'Production manager', '["manage_production"]'::jsonb),
      (${organizationId}, 'commercial_manager', 'Commercial manager', '["manage_commercial"]'::jsonb),
      (${organizationId}, 'assigned_worker', 'Assigned worker', '["do_assigned_work"]'::jsonb)`;
    await sql`insert into people (organization_id, user_id, name, email, role) values
      (${organizationId}, ${productionUserId}, 'Management Production', 'management-production@postpilot.test', 'production_manager'),
      (${organizationId}, ${commercialUserId}, 'Management Commercial', 'management-commercial@postpilot.test', 'commercial_manager'),
      (${organizationId}, ${assignedUserId}, 'Management Assigned', 'management-assigned@postpilot.test', 'assigned_worker')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${foreignShowId}, ${foreignOrganizationId}, 'Foreign show', 'FRM', 'Europe/London')`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values (${foreignCompanyId}, ${foreignOrganizationId}, 'Foreign client', 'client', 'GBP')`;
    await sql`insert into rooms (id, organization_id, name, type) values (${foreignRoomId}, ${foreignOrganizationId}, 'Foreign room', 'edit')`;
    await sql`insert into service_rates (id, organization_id, name, category, unit, rate, currency) values (${foreignRateId}, ${foreignOrganizationId}, 'Foreign rate', 'Suite', 'hour', '120', 'GBP')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${productionUserId}, ${commercialUserId}, ${assignedUserId})`;
    await sql.end();
  });

  test("grants production management only production operations", async ({ page }) => {
    await assume(page, productionUserId);
    const company = await page.request.post("/api/crm/companies", { data: { name: "Route Lab Client", type: "client" } });
    expect(company.status()).toBe(201);
    const room = await page.request.post("/api/rooms", { data: { name: "Route Lab Edit 1", type: "edit" } });
    expect(room.status()).toBe(201);
    expect((await page.request.post("/api/service-rates", { data: { name: "Route Lab Audio Suite", category: "Suite", unit: "hour", rate: 150 } })).status()).toBe(403);

    const createdCompany = await company.json() as { id: string };
    const createdRoom = await room.json() as { id: string };
    expect(await sql`select id from crm_companies where id = ${createdCompany.id} and organization_id = ${organizationId}`).toHaveLength(1);
    expect(await sql`select id from rooms where id = ${createdRoom.id} and organization_id = ${organizationId}`).toHaveLength(1);
  });

  test("grants commercial management commercial operations and shared CRM access", async ({ page }) => {
    await assume(page, commercialUserId);
    const rate = await page.request.post("/api/service-rates", { data: { name: "Route Lab Audio Suite", category: "Suite", unit: "hour", rate: 150 } });
    expect(rate.status()).toBe(201);
    expect((await page.request.post("/api/rooms", { data: { name: "Denied room", type: "edit" } })).status()).toBe(403);
    expect((await page.request.post("/api/crm/companies", { data: { name: "Commercial client", type: "client" } })).status()).toBe(201);
  });

  test("denies an assigned worker all facility and commercial administration", async ({ page }) => {
    await assume(page, assignedUserId);
    expect((await page.request.post("/api/rooms", { data: { name: "Denied room", type: "edit" } })).status()).toBe(403);
    expect((await page.request.post("/api/crm/companies", { data: { name: "Denied client", type: "client" } })).status()).toBe(403);
    expect((await page.request.post("/api/service-rates", { data: { name: "Denied rate", category: "Suite", unit: "hour", rate: 150 } })).status()).toBe(403);
  });

  test("does not permit management routes to mutate foreign tenant records", async ({ page }) => {
    await assume(page, commercialUserId);
    expect((await page.request.patch(`/api/service-rates/${foreignRateId}`, { data: { rate: 200 } })).status()).toBe(404);
    expect((await page.request.post("/api/rate-card-overrides", { data: { scope: { type: "show", showId: foreignShowId }, serviceRateId: foreignRateId, rate: 200 } })).status()).toBe(404);

    await assume(page, productionUserId);
    expect((await page.request.patch(`/api/rooms/${foreignRoomId}`, { data: { name: "Foreign changed" } })).status()).toBe(404);
    expect((await page.request.patch(`/api/crm/companies/${foreignCompanyId}`, { data: { accountStatus: "inactive", bookingClearance: "on_hold" } })).status()).toBe(404);
  });
});
