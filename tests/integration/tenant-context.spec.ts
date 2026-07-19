import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for tenant-context tests.");
const sql = postgres(databaseUrl, { prepare: false });

const userId = "tenant-context-user";
const noMembershipUserId = "tenant-context-no-membership-user";
const organizationAId = "94500000-0000-4000-8000-000000000001";
const organizationBId = "94500000-0000-4000-8000-000000000002";
const foreignOrganizationId = "94500000-0000-4000-8000-000000000003";
const showAId = "94500000-0000-4000-8000-000000000004";
const showBId = "94500000-0000-4000-8000-000000000005";

async function assume(page: Page, organizationId = organizationAId) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/shows" } })).status()).toBe(200);
}

test.describe("Active tenant and show context", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationAId}, ${organizationBId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${userId}, ${noMembershipUserId})`;
    await sql`insert into users (id, name, email) values
      (${userId}, 'Tenant Context User', 'tenant-context@postpilot.test'),
      (${noMembershipUserId}, 'No Membership User', 'tenant-context-no-membership@postpilot.test')`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationAId}, 'Tenant Context A', 'tenant-context-a'),
      (${organizationBId}, 'Tenant Context B', 'tenant-context-b'),
      (${foreignOrganizationId}, 'Tenant Context Foreign', 'tenant-context-foreign')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationAId}, ${userId}, 'member'), (${organizationBId}, ${userId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationAId}, 'observer', 'Observer', '["view_all_operations"]'::jsonb),
      (${organizationBId}, 'observer', 'Observer', '["view_all_operations"]'::jsonb)`;
    await sql`insert into people (organization_id, user_id, name, email, role) values
      (${organizationAId}, ${userId}, 'Tenant Context User', 'tenant-context@postpilot.test', 'observer'),
      (${organizationBId}, ${userId}, 'Tenant Context User', 'tenant-context@postpilot.test', 'observer')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values
      (${showAId}, ${organizationAId}, 'Context Show A', 'CTA', 'Europe/London'),
      (${showBId}, ${organizationBId}, 'Context Show B', 'CTB', 'Europe/London')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationAId}, ${organizationBId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${userId}, ${noMembershipUserId})`;
    await sql.end();
  });

  test("rejects a forged tenant switch and keeps the current valid tenant", async ({ page }) => {
    await assume(page);
    const forged = await page.request.post("/api/organizations/active", { data: { organizationId: foreignOrganizationId, pathname: "/shows" } });
    expect(forged.status()).toBe(403);

    expect((await page.request.post("/api/active-show", { data: { showId: showAId } })).status()).toBe(200);
    expect((await page.request.post("/api/active-show", { data: { showId: showBId } })).status()).toBe(404);
  });

  test("falls back from a stale tenant cookie to a valid membership", async ({ page, context }) => {
    await assume(page);
    await context.addCookies([{ name: "posthouse.activeOrganizationId", value: foreignOrganizationId, url: "http://localhost:5001" }]);

    // The server resolves the stale cookie to the first real membership, so
    // Tenant A data remains selectable and Tenant B data remains unavailable.
    expect((await page.request.post("/api/active-show", { data: { showId: showAId } })).status()).toBe(200);
    expect((await page.request.post("/api/active-show", { data: { showId: showBId } })).status()).toBe(404);
  });

  test("clears the show context and strips an invalid nested route when switching tenants", async ({ page, context }) => {
    await assume(page);
    expect((await page.request.post("/api/active-show", { data: { showId: showAId } })).status()).toBe(200);
    expect((await context.cookies()).some((cookie) => cookie.name === "postpilot.activeShow" && cookie.value === showAId)).toBe(true);

    const switched = await page.request.post("/api/organizations/active", { data: { organizationId: organizationBId, pathname: `/shows/${showAId}` } });
    expect(switched.status()).toBe(200);
    await expect(switched.json()).resolves.toMatchObject({ redirectTo: "/" });
    expect((await context.cookies()).some((cookie) => cookie.name === "postpilot.activeShow")).toBe(false);
  });

  test("accepts only tenant-local show selections and allows clearing All shows", async ({ page, context }) => {
    await assume(page, organizationBId);
    expect((await page.request.post("/api/active-show", { data: { showId: "All shows" } })).status()).toBe(400);
    expect((await page.request.post("/api/active-show", { data: { showId: showBId } })).status()).toBe(200);
    expect((await page.request.post("/api/active-show", { data: { showId: null } })).status()).toBe(200);
    expect((await context.cookies()).some((cookie) => cookie.name === "postpilot.activeShow")).toBe(false);
  });

  test("falls back safely after the active tenant membership is removed", async ({ page }) => {
    await assume(page, organizationBId);
    await sql`delete from organization_members where organization_id = ${organizationBId} and user_id = ${userId}`;

    // The stale B cookie can no longer select B data; resolution falls back to
    // A, the remaining membership, rather than leaving a usable stale tenant.
    expect((await page.request.post("/api/active-show", { data: { showId: showBId } })).status()).toBe(404);
    expect((await page.request.post("/api/active-show", { data: { showId: showAId } })).status()).toBe(200);
  });

  test("does not let debug mode assume a user with no tenant membership", async ({ page }) => {
    expect((await page.request.post("/api/debug/user", { data: { userId: noMembershipUserId } })).status()).toBe(403);
    expect((await page.request.post("/api/debug/user", { data: { userId: "unknown-tenant-context-user" } })).status()).toBe(404);
  });
});
