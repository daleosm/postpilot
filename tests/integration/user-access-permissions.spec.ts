import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for user-access permission tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "94600000-0000-4000-8000-000000000001";
const foreignOrganizationId = "94600000-0000-4000-8000-000000000002";
const adminUserId = "user-access-admin";
const memberUserId = "user-access-member";
const ownerUserId = "user-access-owner";
const foreignUserId = "user-access-foreign";
const createdEmail = "user-access-created-client@postpilot.test";

async function assume(page: Page, userId: string) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/settings/users" } })).status()).toBe(200);
}

test.describe("User access permission boundaries", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${adminUserId}, ${memberUserId}, ${ownerUserId}, ${foreignUserId}) or email = ${createdEmail}`;
    await sql`insert into users (id, name, email) values
      (${adminUserId}, 'Access Admin', 'access-admin@postpilot.test'),
      (${memberUserId}, 'Access Member', 'access-member@postpilot.test'),
      (${ownerUserId}, 'Access Owner', 'access-owner@postpilot.test'),
      (${foreignUserId}, 'Access Foreign', 'access-foreign@postpilot.test')`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationId}, 'User Access Lab', 'user-access-lab'),
      (${foreignOrganizationId}, 'Foreign User Access Lab', 'foreign-user-access-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${adminUserId}, 'admin'),
      (${organizationId}, ${memberUserId}, 'member'),
      (${organizationId}, ${ownerUserId}, 'owner'),
      (${foreignOrganizationId}, ${foreignUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'access_admin', 'Access admin', '["manage_settings"]'::jsonb),
      (${organizationId}, 'worker', 'Worker', '["do_assigned_work"]'::jsonb),
      (${foreignOrganizationId}, 'worker', 'Worker', '["do_assigned_work"]'::jsonb)`;
    await sql`insert into people (organization_id, user_id, name, email, role) values
      (${organizationId}, ${adminUserId}, 'Access Admin', 'access-admin@postpilot.test', 'access_admin'),
      (${organizationId}, ${memberUserId}, 'Access Member', 'access-member@postpilot.test', 'worker'),
      (${organizationId}, ${ownerUserId}, 'Access Owner', 'access-owner@postpilot.test', 'access_admin'),
      (${foreignOrganizationId}, ${foreignUserId}, 'Access Foreign', 'access-foreign@postpilot.test', 'worker')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${adminUserId}, ${memberUserId}, ${ownerUserId}, ${foreignUserId}) or email = ${createdEmail}`;
    await sql.end();
  });

  test("denies user administration to a member without settings access", async ({ page }) => {
    await assume(page, memberUserId);
    const response = await page.request.post("/api/settings/users", { data: { name: "Denied", email: "denied@postpilot.test", personRole: "worker", membershipRole: "member" } });
    expect(response.status()).toBe(403);
  });

  test("creates a Client membership with the fixed Client person role", async ({ page }) => {
    await assume(page, adminUserId);
    const create = await page.request.post("/api/settings/users", { data: { name: "Created Client", email: createdEmail, personRole: "access_admin", membershipRole: "client" } });
    expect(create.status()).toBe(201);
    const body = await create.json() as { id: string };
    const [created] = await sql`select m.role as membership_role, p.role as person_role from organization_members m inner join people p on p.organization_id = m.organization_id and p.user_id = m.user_id where m.organization_id = ${organizationId} and m.user_id = ${body.id}`;
    expect(created).toMatchObject({ membership_role: "client", person_role: "client" });
  });

  test("rejects unknown roles and protects the actor and owner account", async ({ page }) => {
    await assume(page, adminUserId);
    expect((await page.request.post("/api/settings/users", { data: { name: "Unknown role", email: "unknown-role@postpilot.test", personRole: "not_configured", membershipRole: "member" } })).status()).toBe(400);
    expect((await page.request.patch(`/api/settings/users/${adminUserId}`, { data: { personRole: "worker", membershipRole: "member" } })).status()).toBe(409);
    expect((await page.request.delete(`/api/settings/users/${adminUserId}`)).status()).toBe(409);
    expect((await page.request.patch(`/api/settings/users/${ownerUserId}`, { data: { personRole: "worker", membershipRole: "member" } })).status()).toBe(403);
    expect((await page.request.delete(`/api/settings/users/${ownerUserId}`)).status()).toBe(403);
  });

  test("does not update or delete another tenant's user record", async ({ page }) => {
    await assume(page, adminUserId);
    expect((await page.request.patch(`/api/settings/users/${foreignUserId}`, { data: { personRole: "worker", membershipRole: "member" } })).status()).toBe(404);
    expect((await page.request.delete(`/api/settings/users/${foreignUserId}`)).status()).toBe(404);
  });

  test("denies person-bound operational access when a membership has no person record", async ({ page }) => {
    await sql`delete from people where organization_id = ${organizationId} and user_id = ${memberUserId}`;
    await assume(page, memberUserId);
    const response = await page.request.post("/api/catering-requests", { data: { roomId: "94600000-0000-4000-8000-000000000009", requestType: "snack", item: "Water" } });
    expect(response.status()).toBe(403);
  });
});
