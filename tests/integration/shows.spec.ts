import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Shows integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "93000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "93000000-0000-4000-8000-000000000002";
const managerUserId = "user_shows_lab_manager";
const viewerUserId = "user_shows_lab_viewer";
const managerPersonId = "93000000-0000-4000-8000-000000000003";
const viewerPersonId = "93000000-0000-4000-8000-000000000004";
const clientCompanyId = "93000000-0000-4000-8000-000000000005";
const productionCompanyId = "93000000-0000-4000-8000-000000000006";
const foreignCompanyId = "93000000-0000-4000-8000-000000000007";

async function switchUser(page: Page, userId: string) {
  const user = await page.request.post("/api/debug/user", { data: { userId } });
  expect(user.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/shows" } });
  expect(tenant.status()).toBe(200);
}

test.describe("Shows integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${managerUserId}, 'Shows Lab Manager', 'shows-lab-manager@postpilot.test'),
      (${viewerUserId}, 'Shows Lab Viewer', 'shows-lab-viewer@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationId}, 'Shows Integration Lab', 'shows-integration-lab'),
      (${foreignOrganizationId}, 'Foreign Shows Lab', 'foreign-shows-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${managerUserId}, 'member'),
      (${organizationId}, ${viewerUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'show_manager', 'Show manager', '["manage_shows"]'::jsonb),
      (${organizationId}, 'show_viewer', 'Show viewer', '["view_assigned"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Shows Lab Manager', 'shows-lab-manager@postpilot.test', 'show_manager'),
      (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'Shows Lab Viewer', 'shows-lab-viewer@postpilot.test', 'show_viewer')`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values
      (${clientCompanyId}, ${organizationId}, 'Shows Lab Network', 'network', 'GBP'),
      (${productionCompanyId}, ${organizationId}, 'Shows Lab Productions', 'production_company', 'GBP'),
      (${foreignCompanyId}, ${foreignOrganizationId}, 'Foreign Network', 'network', 'GBP')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${viewerUserId})`;
    await sql.end();
  });

  test("creates and updates a show inside the active tenant", async ({ page }) => {
    await switchUser(page, managerUserId);
    const create = await page.request.post("/api/shows", { data: {
      title: "Signal Line", code: "sl", clientCompanyId, productionCompanyId, description: "Initial post plan.",
    } });
    expect(create.status()).toBe(201);
    const showId = (await create.json()).id as string;
    const [created] = await sql`select organization_id, title, code, client_company_id, production_company_id, description from shows where id = ${showId}`;
    expect(created).toMatchObject({ organization_id: organizationId, title: "Signal Line", code: "SL", client_company_id: clientCompanyId, production_company_id: productionCompanyId, description: "Initial post plan." });

    const update = await page.request.patch(`/api/shows/${showId}`, { data: { title: "Signal Line: Final", code: "slf", description: "Updated post plan." } });
    expect(update.status()).toBe(200);
    const [saved] = await sql`select title, code, description from shows where id = ${showId} and organization_id = ${organizationId}`;
    expect(saved).toMatchObject({ title: "Signal Line: Final", code: "SLF", description: "Updated post plan." });
  });

  test("rejects invalid Show payloads before writing", async ({ page }) => {
    await switchUser(page, managerUserId);
    const response = await page.request.post("/api/shows", { data: { title: "", code: "x" } });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Check the show details and try again." });
    const [count] = await sql`select count(*)::int as count from shows where organization_id = ${organizationId}`;
    expect(count.count).toBe(1);
  });

  test("does not let a tenant member without Shows permission create or edit a show", async ({ page }) => {
    await switchUser(page, viewerUserId);
    const create = await page.request.post("/api/shows", { data: { title: "Unauthorised", code: "NO" } });
    expect(create.status()).toBe(403);
    const [show] = await sql`select id from shows where organization_id = ${organizationId} limit 1`;
    const update = await page.request.patch(`/api/shows/${show.id}`, { data: { title: "Unauthorised change" } });
    expect(update.status()).toBe(403);
  });

  test.fail("rejects CRM companies from another tenant", async ({ page }) => {
    await switchUser(page, managerUserId);
    const response = await page.request.post("/api/shows", { data: { title: "Cross-tenant account attempt", code: "XTA", clientCompanyId: foreignCompanyId } });
    expect(response.status()).toBe(404);
    const [show] = await sql`select id from shows where organization_id = ${organizationId} and code = 'XTA'`;
    expect(show).toBeUndefined();
  });
});
