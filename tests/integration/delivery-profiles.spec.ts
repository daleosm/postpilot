import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for delivery profile integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "93200000-0000-4000-8000-000000000001";
const foreignOrganizationId = "93200000-0000-4000-8000-000000000002";
const managerUserId = "user_delivery_profile_manager";
const viewerUserId = "user_delivery_profile_viewer";
const foreignManagerUserId = "user_delivery_profile_foreign_manager";
const managerPersonId = "93200000-0000-4000-8000-000000000003";
const viewerPersonId = "93200000-0000-4000-8000-000000000004";
const foreignManagerPersonId = "93200000-0000-4000-8000-000000000005";
const clientCompanyId = "93200000-0000-4000-8000-000000000006";
const secondClientCompanyId = "93200000-0000-4000-8000-000000000007";
const networkCompanyId = "93200000-0000-4000-8000-000000000008";
const vendorCompanyId = "93200000-0000-4000-8000-000000000009";
const foreignCompanyId = "93200000-0000-4000-8000-000000000010";
const showId = "93200000-0000-4000-8000-000000000011";
const foreignShowId = "93200000-0000-4000-8000-000000000012";
const seasonId = "93200000-0000-4000-8000-000000000013";
const episodeId = "93200000-0000-4000-8000-000000000014";
const technicalContactId = "93200000-0000-4000-8000-000000000015";
const networkContactId = "93200000-0000-4000-8000-000000000016";
const vendorContactId = "93200000-0000-4000-8000-000000000017";
const foreignContactId = "93200000-0000-4000-8000-000000000018";
const baseProfileId = "93200000-0000-4000-8000-000000000019";

async function activate(page: Page, activeOrganizationId: string, pathname = "/settings/delivery-profiles") {
  const response = await page.request.post("/api/organizations/active", { data: { organizationId: activeOrganizationId, pathname } });
  expect(response.status()).toBe(200);
}

async function switchUser(page: Page, userId: string, activeOrganizationId: string) {
  const response = await page.request.post("/api/debug/user", { data: { userId } });
  expect(response.status()).toBe(200);
  await activate(page, activeOrganizationId);
}

async function createProfile(page: Page, payload: Record<string, unknown>) {
  return page.request.post("/api/delivery-profiles", { data: { clientCompanyId: null, network: null, showId: null, specificationUrl: null, isActive: true, ...payload } });
}

test.describe("Delivery profile management", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${managerUserId}, 'Delivery Profile Manager', 'delivery-profile-manager@postpilot.test'),
      (${viewerUserId}, 'Delivery Profile Viewer', 'delivery-profile-viewer@postpilot.test'),
      (${foreignManagerUserId}, 'Foreign Delivery Profile Manager', 'foreign-delivery-profile-manager@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationId}, 'Delivery Profile Lab', 'delivery-profile-lab'),
      (${foreignOrganizationId}, 'Foreign Delivery Profile Lab', 'foreign-delivery-profile-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${managerUserId}, 'member'),
      (${organizationId}, ${viewerUserId}, 'member'),
      (${foreignOrganizationId}, ${foreignManagerUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'delivery_profile_manager', 'Delivery profile manager', '["manage_delivery_profiles","manage_episode_manifests"]'::jsonb),
      (${organizationId}, 'delivery_profile_viewer', 'Delivery profile viewer', '[]'::jsonb),
      (${foreignOrganizationId}, 'delivery_profile_manager', 'Delivery profile manager', '["manage_delivery_profiles"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Delivery Profile Manager', 'delivery-profile-manager@postpilot.test', 'delivery_profile_manager'),
      (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'Delivery Profile Viewer', 'delivery-profile-viewer@postpilot.test', 'delivery_profile_viewer'),
      (${foreignManagerPersonId}, ${foreignOrganizationId}, ${foreignManagerUserId}, 'Foreign Delivery Profile Manager', 'foreign-delivery-profile-manager@postpilot.test', 'delivery_profile_manager')`;
    await sql`insert into crm_companies (id, organization_id, name, type) values
      (${clientCompanyId}, ${organizationId}, 'Profile Client', 'client'),
      (${secondClientCompanyId}, ${organizationId}, 'Other Profile Client', 'client'),
      (${networkCompanyId}, ${organizationId}, 'Profile Network', 'network'),
      (${vendorCompanyId}, ${organizationId}, 'Profile Vendor', 'vendor'),
      (${foreignCompanyId}, ${foreignOrganizationId}, 'Foreign Profile Client', 'client')`;
    await sql`insert into crm_contacts (id, organization_id, company_id, name, email, contact_type) values
      (${technicalContactId}, ${organizationId}, ${clientCompanyId}, 'Technical Profile Contact', 'technical@profile.test', 'technical_delivery'),
      (${networkContactId}, ${organizationId}, ${networkCompanyId}, 'Network Profile Contact', 'network@profile.test', 'technical_delivery'),
      (${vendorContactId}, ${organizationId}, ${vendorCompanyId}, 'Vendor Profile Contact', 'vendor@profile.test', 'technical_delivery'),
      (${foreignContactId}, ${foreignOrganizationId}, ${foreignCompanyId}, 'Foreign Profile Contact', 'foreign@profile.test', 'technical_delivery')`;
    await sql`insert into shows (id, organization_id, title, code, network, client_company_id, time_zone) values
      (${showId}, ${organizationId}, 'Profile Test Show', 'PTS', 'Profile Network', ${clientCompanyId}, 'Europe/London'),
      (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Profile Show', 'FPS', 'Foreign Network', ${foreignCompanyId}, 'Europe/London')`;
    await sql`insert into show_contacts (organization_id, show_id, contact_id, responsibility, relationship) values (${organizationId}, ${showId}, ${technicalContactId}, 'delivery_qc', 'Technical recipient')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status, delivery_deadline) values (${episodeId}, ${organizationId}, ${seasonId}, 1, 'Profile episode', 'online', 'not_started', '2026-08-20')`;
    await sql`insert into delivery_profiles (id, organization_id, client_company_id, network, show_id, name, is_active) values (${baseProfileId}, ${organizationId}, ${clientCompanyId}, 'Profile Network', ${showId}, 'Network episodic delivery', true)`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${viewerUserId}, ${foreignManagerUserId})`;
    await sql.end();
  });

  test("enforces the delivery-profile capability on the page and every profile mutation", async ({ page }) => {
    await switchUser(page, viewerUserId, organizationId);
    const createDenied = await createProfile(page, { name: "Denied profile" });
    expect(createDenied.status()).toBe(403);
    const updateDenied = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { name: "Denied update" } });
    expect(updateDenied.status()).toBe(403);
    const addItemDenied = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "master", label: "Denied item", required: true, requiresExternalRecipient: false, qcRequired: false, position: 1 } });
    expect(addItemDenied.status()).toBe(403);
    const updateItemDenied = await page.request.patch(`/api/delivery-profiles/${baseProfileId}/items/93200000-0000-4000-8000-000000000099`, { data: { label: "Denied item update" } });
    expect(updateItemDenied.status()).toBe(403);
    await page.goto("/settings/delivery-profiles");
    await expect(page).not.toHaveURL(/settings\/delivery-profiles$/);
  });

  test("renders the no-profile state for an otherwise authorised empty post house", async ({ page }) => {
    await switchUser(page, foreignManagerUserId, foreignOrganizationId);
    await page.goto("/settings/delivery-profiles");
    await expect(page.getByText("No delivery profiles yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "New delivery profile" })).toBeVisible();
  });

  test("lets a delivery-profile manager create and edit a profile and requirement in the settings UI", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    await page.goto("/settings/delivery-profiles");
    await expect(page.getByRole("complementary").getByRole("link", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "New delivery profile" }).click();
    await page.getByLabel("Profile name").fill("Browser delivery profile");
    await page.getByLabel("Specification link (optional)").fill("https://specs.example/browser-profile");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByText("Browser delivery profile", { exact: true })).toBeVisible();

    let profileRow = page.getByText("Browser delivery profile", { exact: true }).locator("xpath=../../..");
    await profileRow.getByRole("button", { name: "Edit profile" }).click();
    await page.getByLabel("Profile name").fill("Browser delivery profile v2");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Browser delivery profile v2", { exact: true })).toBeVisible();

    profileRow = page.getByText("Browser delivery profile v2", { exact: true }).locator("xpath=../../..");
    await profileRow.getByRole("button", { name: "Add requirement" }).click();
    await page.getByLabel("Display label").fill("Browser ProRes master");
    await page.getByLabel("Format / specification").fill("ProRes 422 HQ");
    await page.getByLabel("External recipient required").check();
    await page.locator('[class*="fixed inset-0"]').getByRole("button", { name: "Add requirement" }).click();
    await expect(page.getByText("Browser ProRes master", { exact: true })).toBeVisible();

    const requirementRow = page.getByText("Browser ProRes master", { exact: true }).locator("xpath=../..");
    await requirementRow.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Display label").fill("Browser ProRes master v2");
    await page.getByRole("button", { name: "Save requirement" }).click();
    await expect(page.getByText("Browser ProRes master v2", { exact: true })).toBeVisible();
  });

  test("creates profiles with tenant-local names and validates profile scope", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const created = await createProfile(page, { name: "Created network profile", clientCompanyId, network: "Profile Network", showId, specificationUrl: "https://specs.example/profile" });
    expect(created.status()).toBe(201);
    const { profile } = await created.json();
    expect(profile).toMatchObject({ name: "Created network profile", clientCompanyId, network: "Profile Network", showId, isActive: true });

    const duplicate = await createProfile(page, { name: "Created network profile" });
    expect(duplicate.status()).toBe(409);
    const invalidLink = await createProfile(page, { name: "Bad URL", specificationUrl: "not-a-url" });
    expect(invalidLink.status()).toBe(400);
    const vendor = await createProfile(page, { name: "Vendor profile", clientCompanyId: vendorCompanyId });
    expect(vendor.status()).toBe(404);
    const foreignClient = await createProfile(page, { name: "Foreign client profile", clientCompanyId: foreignCompanyId });
    expect(foreignClient.status()).toBe(404);
    const wrongClient = await createProfile(page, { name: "Mismatched client profile", clientCompanyId: secondClientCompanyId, showId });
    expect(wrongClient.status()).toBe(409);
    const wrongNetwork = await createProfile(page, { name: "Mismatched network profile", network: "Different Network", showId });
    expect(wrongNetwork.status()).toBe(409);
    const foreignShow = await createProfile(page, { name: "Foreign show profile", showId: foreignShowId });
    expect(foreignShow.status()).toBe(404);

    await switchUser(page, foreignManagerUserId, foreignOrganizationId);
    const crossTenantName = await createProfile(page, { name: "Created network profile" });
    expect(crossTenantName.status()).toBe(201);
  });

  test("updates a profile only in its active tenant and never accepts foreign scope values", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const updated = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { name: "Network episodic delivery v2", clientCompanyId, network: "Profile Network", showId, specificationUrl: null, isActive: false } });
    expect(updated.status()).toBe(200);
    const other = await createProfile(page, { name: "Another delivery profile" });
    expect(other.status()).toBe(201);
    const duplicateNameEdit = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { name: "Another delivery profile" } });
    expect(duplicateNameEdit.status()).toBe(409);
    const mismatch = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { clientCompanyId: secondClientCompanyId } });
    expect(mismatch.status()).toBe(409);
    const foreignScope = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { showId: foreignShowId } });
    expect(foreignScope.status()).toBe(404);

    await switchUser(page, foreignManagerUserId, foreignOrganizationId);
    const crossTenant = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { name: "Stolen profile" } });
    expect(crossTenant.status()).toBe(404);
  });

  test("creates and edits profile requirements with recipient, position, and tenant checks", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const reactivate = await page.request.patch(`/api/delivery-profiles/${baseProfileId}`, { data: { isActive: true } });
    expect(reactivate.status()).toBe(200);
    const master = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "master", label: "ProRes master", required: true, formatSpecification: "ProRes 422 HQ", version: "TX v1", territory: "UK", language: "English", recipientContactId: technicalContactId, requiresExternalRecipient: true, qcRequired: true, defaultDeadlineOffsetDays: 0, position: 1 } });
    expect(master.status()).toBe(201);
    const { item } = await master.json();
    const duplicatePosition = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "captions", label: "Captions", required: true, recipientContactId: networkContactId, requiresExternalRecipient: true, qcRequired: false, defaultDeadlineOffsetDays: 1, position: 1 } });
    expect(duplicatePosition.status()).toBe(409);
    const invalidOffset = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "captions", label: "Bad offset", required: true, recipientContactId: networkContactId, requiresExternalRecipient: true, qcRequired: false, defaultDeadlineOffsetDays: 3651, position: 2 } });
    expect(invalidOffset.status()).toBe(400);
    const vendorRecipient = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "metadata", label: "Vendor recipient", required: true, recipientContactId: vendorContactId, requiresExternalRecipient: true, qcRequired: false, defaultDeadlineOffsetDays: null, position: 2 } });
    expect(vendorRecipient.status()).toBe(409);
    const foreignRecipient = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "metadata", label: "Foreign recipient", required: true, recipientContactId: foreignContactId, requiresExternalRecipient: true, qcRequired: false, defaultDeadlineOffsetDays: null, position: 2 } });
    expect(foreignRecipient.status()).toBe(409);
    const captions = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "captions", label: "English captions", required: true, recipientContactId: networkContactId, requiresExternalRecipient: true, qcRequired: false, defaultDeadlineOffsetDays: 1, position: 2 } });
    expect(captions.status()).toBe(201);
    const { item: captionItem } = await captions.json();
    const collidingEdit = await page.request.patch(`/api/delivery-profiles/${baseProfileId}/items/${captionItem.id}`, { data: { position: 1 } });
    expect(collidingEdit.status()).toBe(409);
    const updated = await page.request.patch(`/api/delivery-profiles/${baseProfileId}/items/${item.id}`, { data: { label: "ProRes master v2", defaultDeadlineOffsetDays: -1 } });
    expect(updated.status()).toBe(200);

    await switchUser(page, foreignManagerUserId, foreignOrganizationId);
    const addForeign = await page.request.post(`/api/delivery-profiles/${baseProfileId}/items`, { data: { componentType: "master", label: "Foreign item", required: true, requiresExternalRecipient: false, qcRequired: false, position: 3 } });
    expect(addForeign.status()).toBe(404);
    const editForeign = await page.request.patch(`/api/delivery-profiles/${baseProfileId}/items/${item.id}`, { data: { label: "Stolen item" } });
    expect(editForeign.status()).toBe(404);
  });

  test("applies only active compatible profiles and preserves applied snapshots after profile edits", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const applied = await page.request.post(`/api/episodes/${episodeId}/delivery-manifest/apply`, { data: { deliveryProfileId: baseProfileId, reason: "Network delivery requirements confirmed." } });
    expect(applied.status()).toBe(200);
    const [snapshot] = await sql`select label, due_date from episode_delivery_items where organization_id = ${organizationId} and episode_id = ${episodeId} order by position limit 1`;
    expect(snapshot.label).toBe("ProRes master v2");
    expect(new Date(snapshot.due_date as Date).toISOString().slice(0, 10)).toBe("2026-08-19");
    const editProfile = await page.request.patch(`/api/delivery-profiles/${baseProfileId}/items/${(await sql`select id from delivery_profile_items where organization_id = ${organizationId} and delivery_profile_id = ${baseProfileId} and position = 1`)[0].id}`, { data: { label: "Changed after apply" } });
    expect(editProfile.status()).toBe(200);
    const [unchangedSnapshot] = await sql`select label from episode_delivery_items where organization_id = ${organizationId} and episode_id = ${episodeId} order by position limit 1`;
    expect(unchangedSnapshot.label).toBe("ProRes master v2");

    const inactive = await createProfile(page, { name: "Inactive profile", clientCompanyId, network: "Profile Network", showId, isActive: false });
    expect(inactive.status()).toBe(201);
    const { profile: inactiveProfile } = await inactive.json();
    const cannotApply = await page.request.post(`/api/episodes/${episodeId}/delivery-manifest/apply`, { data: { deliveryProfileId: inactiveProfile.id, reason: "This must not apply." } });
    expect(cannotApply.status()).toBe(404);
  });
});
