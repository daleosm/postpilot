import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for permission integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "94400000-0000-4000-8000-000000000001";
const foreignOrganizationId = "94400000-0000-4000-8000-000000000008";
const showId = "94400000-0000-4000-8000-000000000002";
const seasonId = "94400000-0000-4000-8000-000000000003";
const settingsUserId = "permission-settings-user";
const operatorUserId = "permission-operator-user";
const clientUserId = "permission-client-user";
const settingsPersonId = "94400000-0000-4000-8000-000000000004";
const operatorPersonId = "94400000-0000-4000-8000-000000000005";
const clientPersonId = "94400000-0000-4000-8000-000000000006";
const cateringRequestId = "94400000-0000-4000-8000-000000000007";

async function assume(page: Page, userId: string) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/settings/roles" } })).status()).toBe(200);
}

const policies = (operatorPermissions: string[]) => [
  { role: "settings_manager", label: "Settings manager", permissions: ["manage_settings"] },
  { role: "production_operator", label: "Production operator", permissions: operatorPermissions },
];

test.describe("Tenant capability policies", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`insert into users (id, name, email) values
      (${settingsUserId}, 'Permission Settings', 'permission-settings@postpilot.test'),
      (${operatorUserId}, 'Permission Operator', 'permission-operator@postpilot.test'),
      (${clientUserId}, 'Permission Client', 'permission-client@postpilot.test')`;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Permission Policy Lab', 'permission-policy-lab')`;
    await sql`insert into organizations (id, name, slug) values (${foreignOrganizationId}, 'Foreign Permission Policy Lab', 'foreign-permission-policy-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${settingsUserId}, 'member'),
      (${organizationId}, ${operatorUserId}, 'member'),
      (${organizationId}, ${clientUserId}, 'client')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'settings_manager', 'Settings manager', '["manage_settings"]'::jsonb),
      (${organizationId}, 'production_operator', 'Production operator', '["do_assigned_work"]'::jsonb)`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${foreignOrganizationId}, 'production_operator', 'Foreign production operator', '["manage_commercial"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${settingsPersonId}, ${organizationId}, ${settingsUserId}, 'Permission Settings', 'permission-settings@postpilot.test', 'settings_manager'),
      (${operatorPersonId}, ${organizationId}, ${operatorUserId}, 'Permission Operator', 'permission-operator@postpilot.test', 'production_operator'),
      (${clientPersonId}, ${organizationId}, ${clientUserId}, 'Permission Client', 'permission-client@postpilot.test', 'client')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Permission Series', 'PERM', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into catering_requests (id, organization_id, requested_by_person_id, request_type, item) values (${cateringRequestId}, ${organizationId}, ${operatorPersonId}, 'tea_coffee', 'Tea')`;
  });

  test.beforeEach(async () => {
    await sql`update organization_role_policies set permissions = '["do_assigned_work"]'::jsonb where organization_id = ${organizationId} and role = 'production_operator'`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await sql`delete from users where id in (${settingsUserId}, ${operatorUserId}, ${clientUserId})`;
    await sql.end();
  });

  test("protects role policy changes and keeps the fixed Client policy immutable", async ({ page }) => {
    await assume(page, operatorUserId);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: [] } })).status()).toBe(403);

    await assume(page, settingsUserId);
    const fixedClient = await page.request.patch("/api/settings/role-policies", { data: { policies: [...policies(["do_assigned_work"]), { role: "client", label: "Changed", permissions: [] }] } });
    expect(fixedClient.status()).toBe(400);
    const duplicate = await page.request.patch("/api/settings/role-policies", { data: { policies: [...policies(["do_assigned_work"]), { role: "production_operator", label: "Duplicate", permissions: [] }] } });
    expect(duplicate.status()).toBe(400);
    const malformed = await page.request.patch("/api/settings/role-policies", { data: { policies: [{ role: "bad role", label: "Bad role", permissions: [] }, ...policies(["do_assigned_work"])] } });
    expect(malformed.status()).toBe(400);
    const removeInUse = await page.request.patch("/api/settings/role-policies", { data: { policies: [{ role: "settings_manager", label: "Settings manager", permissions: ["manage_settings"] }] } });
    expect(removeInUse.status()).toBe(409);
  });

  test("never writes a role policy outside the active tenant", async ({ page }) => {
    await assume(page, settingsUserId);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: policies(["manage_production"]) } })).status()).toBe(200);

    const [foreignPolicy] = await sql<{ permissions: string[] }[]>`select permissions from organization_role_policies where organization_id = ${foreignOrganizationId} and role = 'production_operator'`;
    expect(foreignPolicy.permissions).toEqual(["manage_commercial"]);
  });

  test("persists and removes an unused tenant-custom role", async ({ page }) => {
    await assume(page, settingsUserId);
    const withTemporaryRole = [...policies(["do_assigned_work"]), { role: "temporary_observer", label: "Temporary observer", permissions: ["view_all_operations"] }];
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: withTemporaryRole } })).status()).toBe(200);
    expect(await sql`select role from organization_role_policies where organization_id = ${organizationId} and role = 'temporary_observer'`).toHaveLength(1);

    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: policies(["do_assigned_work"]) } })).status()).toBe(200);
    expect(await sql`select role from organization_role_policies where organization_id = ${organizationId} and role = 'temporary_observer'`).toHaveLength(0);
  });

  test("applies a saved capability change immediately to server mutations", async ({ page }) => {
    await assume(page, operatorUserId);
    const before = await page.request.post("/api/episodes", { data: { seasonId, number: 1, title: "Denied before grant" } });
    expect(before.status()).toBe(403);

    await assume(page, settingsUserId);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: policies(["manage_production"]) } })).status()).toBe(200);

    await assume(page, operatorUserId);
    const after = await page.request.post("/api/episodes", { data: { seasonId, number: 1, title: "Allowed after grant" } });
    expect(after.status()).toBe(201);

    await assume(page, settingsUserId);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: policies(["do_assigned_work"]) } })).status()).toBe(200);
    await assume(page, operatorUserId);
    expect((await page.request.post("/api/episodes", { data: { seasonId, number: 2, title: "Denied after revocation" } })).status()).toBe(403);
  });

  test("keeps Client users out of operational and commercial mutations", async ({ page }) => {
    await assume(page, clientUserId);
    expect((await page.request.post("/api/episodes", { data: { seasonId, number: 2, title: "Client cannot create" } })).status()).toBe(403);
    expect((await page.request.post("/api/bookings/conflicts", { data: {} })).status()).toBe(403);
    expect((await page.request.post("/api/catering-requests", { data: {} })).status()).toBe(403);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: [] } })).status()).toBe(403);
    expect((await page.request.post("/api/rooms", { data: { name: "Client room", type: "edit" } })).status()).toBe(403);
    expect((await page.request.post("/api/crm/companies", { data: { name: "Client account", type: "client" } })).status()).toBe(403);
    expect((await page.request.get("/api/rate-card-overrides?type=master")).status()).toBe(403);
    expect((await page.request.get("/api/purchase-orders")).status()).toBe(403);
    expect((await page.request.post("/api/work-orders", { data: {} })).status()).toBe(403);
  });

  test("makes View all operations a read-only observer capability", async ({ page }) => {
    await assume(page, settingsUserId);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: policies(["view_all_operations"]) } })).status()).toBe(200);

    await assume(page, operatorUserId);
    await page.goto("/episodes");
    await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Shows" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New episode" })).toHaveCount(0);
    await page.goto(`/shows/${showId}`);
    await expect(page.getByRole("heading", { name: "Permission Series" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit show" })).toHaveCount(0);
    await page.goto("/bookings");
    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
    expect((await page.request.post("/api/episodes", { data: { seasonId, number: 3, title: "Observer cannot create" } })).status()).toBe(403);
  });

  test("allows only the runner-desk capability to fulfil catering requests", async ({ page }) => {
    await assume(page, settingsUserId);
    expect((await page.request.patch("/api/settings/role-policies", { data: { policies: policies(["manage_catering"]) } })).status()).toBe(200);

    await assume(page, operatorUserId);
    expect((await page.request.patch(`/api/catering-requests/${cateringRequestId}`, { data: { status: "preparing" } })).status()).toBe(200);

    await assume(page, clientUserId);
    expect((await page.request.patch(`/api/catering-requests/${cateringRequestId}`, { data: { status: "delivered" } })).status()).toBe(403);
  });

  test("renders the fixed Client policy as non-editable in role settings", async ({ page }) => {
    await assume(page, settingsUserId);
    await page.goto("/settings/roles");
    await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();
    const clientPolicy = page.locator("section").filter({ hasText: "System role" });
    await expect(clientPolicy.getByLabel("Role label")).toBeDisabled();
    await expect(clientPolicy.getByLabel("Role key")).toBeDisabled();
    const permissionControls = clientPolicy.locator('input[type="checkbox"]');
    await expect(permissionControls).toHaveCount(8);
    expect(await permissionControls.evaluateAll((inputs) => inputs.every((input) => (input as HTMLInputElement).disabled))).toBe(true);
  });

  test("creates a custom role through the role settings UI", async ({ page }) => {
    await assume(page, settingsUserId);
    await page.goto("/settings/roles");
    await page.getByRole("button", { name: "Add role" }).click();
    const policyCards = page.locator("section");
    const addedRole = policyCards.last();
    await addedRole.getByLabel("Role label").fill("UI observer");
    await addedRole.getByLabel("Role key").fill("ui_observer");
    await addedRole.getByLabel("View all operations").check();
    await page.getByRole("button", { name: "Save roles & permissions" }).click();
    await expect(page.getByRole("status")).toContainText("saved");
    expect(await sql`select role from organization_role_policies where organization_id = ${organizationId} and role = 'ui_observer'`).toHaveLength(1);
  });
});
