import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { LOGIN_FAILURE_LIMIT } from "@/lib/auth-login-throttle";
import { hashPassword } from "@/lib/password";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for credentials-auth tests.");
const sql = postgres(databaseUrl, { prepare: false });

const memberUserId = "credentials-auth-member";
const noMembershipUserId = "credentials-auth-no-membership";
const noHashUserId = "credentials-auth-no-hash";
const lockedUserId = "credentials-auth-locked";
const memberEmail = "credentials-member@postpilot.test";
const organizationAId = "95500000-0000-4000-8000-000000000001";
const organizationBId = "95500000-0000-4000-8000-000000000002";
const foreignOrganizationId = "95500000-0000-4000-8000-000000000003";

async function signIn(page: Page, email: string, password = "password") {
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("Auth.js credentials authentication", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationAId}, ${organizationBId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${memberUserId}, ${noMembershipUserId}, ${noHashUserId}, ${lockedUserId})`;
    await sql`delete from auth_login_attempts where email in (${memberEmail}, 'credentials-no-membership@postpilot.test', 'credentials-no-hash@postpilot.test', 'credentials-locked@postpilot.test', 'credentials-unknown@postpilot.test')`;

    await sql`insert into users (id, name, email, password_hash) values
      (${memberUserId}, 'Credentials Member', ${memberEmail}, ${await hashPassword("password")}),
      (${noMembershipUserId}, 'No Membership', 'credentials-no-membership@postpilot.test', ${await hashPassword("password")}),
      (${noHashUserId}, 'No Hash', 'credentials-no-hash@postpilot.test', null),
      (${lockedUserId}, 'Locked User', 'credentials-locked@postpilot.test', ${await hashPassword("password")})`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationAId}, 'Credentials Auth A', 'credentials-auth-a'),
      (${organizationBId}, 'Credentials Auth B', 'credentials-auth-b'),
      (${foreignOrganizationId}, 'Credentials Auth Foreign', 'credentials-auth-foreign')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationAId}, ${memberUserId}, 'member'), (${organizationBId}, ${memberUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationAId}, 'observer', 'Observer', '["view_all_operations"]'::jsonb),
      (${organizationBId}, 'observer', 'Observer', '["view_all_operations"]'::jsonb)`;
    await sql`insert into people (organization_id, user_id, name, email, role) values
      (${organizationAId}, ${memberUserId}, 'Credentials Member', ${memberEmail}, 'observer'),
      (${organizationBId}, ${memberUserId}, 'Credentials Member', ${memberEmail}, 'observer')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationAId}, ${organizationBId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${memberUserId}, ${noMembershipUserId}, ${noHashUserId}, ${lockedUserId})`;
    await sql`delete from auth_login_attempts where email in (${memberEmail}, 'credentials-no-membership@postpilot.test', 'credentials-no-hash@postpilot.test', 'credentials-locked@postpilot.test', 'credentials-unknown@postpilot.test')`;
    await sql.end();
  });

  test("protects tenant routes, restores the safe callback path, and resolves live membership", async ({ page }) => {
    await page.goto("/episodes");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fepisodes/);

    const unauthenticatedApi = await page.request.post("/api/organizations/active", {
      data: { organizationId: organizationAId, pathname: "/shows" },
      maxRedirects: 0,
    });
    expect(unauthenticatedApi.status()).toBe(307);
    expect(unauthenticatedApi.headers().location).toContain("/sign-in");

    await page.goto("/shows");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fshows/);

    await signIn(page, memberEmail);
    await expect(page).toHaveURL(/\/shows$/);
    await expect(page.getByRole("heading", { name: "Shows in post" })).toBeVisible();

    const sessionA = await page.request.get("/api/auth/session");
    await expect(sessionA.json()).resolves.toMatchObject({ user: { id: memberUserId }, activeOrganizationId: organizationAId });

    expect((await page.request.post("/api/organizations/active", { data: { organizationId: organizationBId, pathname: "/shows" } })).status()).toBe(200);
    const sessionB = await page.request.get("/api/auth/session");
    await expect(sessionB.json()).resolves.toMatchObject({ activeOrganizationId: organizationBId });

    expect((await page.request.post("/api/organizations/active", { data: { organizationId: foreignOrganizationId, pathname: "/shows" } })).status()).toBe(403);
    await sql`delete from organization_members where organization_id = ${organizationBId} and user_id = ${memberUserId}`;
    const revokedSession = await page.request.get("/api/auth/session");
    await expect(revokedSession.json()).resolves.toMatchObject({ activeOrganizationId: organizationAId });
    expect((await page.request.post("/api/organizations/active", { data: { organizationId: organizationBId, pathname: "/shows" } })).status()).toBe(403);
  });

  test("rejects unknown, unhashed, and malformed credential submissions with one message", async ({ page }) => {
    for (const [email, password] of [
      ["credentials-unknown@postpilot.test", "password"],
      ["credentials-no-hash@postpilot.test", "password"],
      [memberEmail, "x".repeat(1025)],
    ]) {
      await page.goto("/sign-in");
      await signIn(page, email, password);
      await expect(page.getByText("Email or password is incorrect.", { exact: true })).toBeVisible();
    }
  });

  test("locks repeated failures without revealing the lock and blocks valid credentials until expiry", async ({ page }) => {
    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
      await page.goto("/sign-in");
      await signIn(page, "credentials-locked@postpilot.test", "incorrect-password");
      await expect(page.getByText("Email or password is incorrect.", { exact: true })).toBeVisible();
    }

    const [record] = await sql`select failed_attempts, locked_until from auth_login_attempts where email = 'credentials-locked@postpilot.test'`;
    expect(record.failed_attempts).toBe(LOGIN_FAILURE_LIMIT);
    expect(record.locked_until).not.toBeNull();

    await page.goto("/sign-in");
    await signIn(page, "credentials-locked@postpilot.test");
    await expect(page.getByText("Email or password is incorrect.", { exact: true })).toBeVisible();

    await sql`update auth_login_attempts set locked_until = now() - interval '1 second', window_started_at = now() - interval '1 hour' where email = 'credentials-locked@postpilot.test'`;
    await page.goto("/sign-in");
    await signIn(page, "credentials-locked@postpilot.test");
    await expect(page).toHaveURL(/\/$/);
    expect(await sql`select email from auth_login_attempts where email = 'credentials-locked@postpilot.test'`).toHaveLength(0);
  });

  test("blocks external callback URLs, logs out, and shows no-membership state", async ({ page }) => {
    await page.goto("/sign-in?callbackUrl=https%3A%2F%2Fevil.example%2Fsteal");
    await signIn(page, memberEmail);
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/shows");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fshows/);

    await page.goto("/sign-in");
    await signIn(page, "credentials-no-membership@postpilot.test");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("No post workspace selected", { exact: true })).toBeVisible();
    expect((await page.request.post("/api/organizations/active", { data: { organizationId: organizationAId, pathname: "/shows" } })).status()).toBe(403);
  });
});
