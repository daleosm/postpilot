import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for delivery permission integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "93000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "93000000-0000-4000-8000-000000000002";
const showId = "93000000-0000-4000-8000-000000000003";
const seasonId = "93000000-0000-4000-8000-000000000004";
const episodeId = "93000000-0000-4000-8000-000000000005";
const manifestId = "93000000-0000-4000-8000-000000000006";
const managerUserId = "user_delivery_permission_manager";
const guestUserId = "user_delivery_permission_guest";
const foreignGuestUserId = "user_delivery_permission_foreign_guest";
const foreignManagerUserId = "user_delivery_permission_foreign_manager";
const managerPersonId = "93000000-0000-4000-8000-000000000007";
const guestPersonId = "93000000-0000-4000-8000-000000000008";
const foreignGuestPersonId = "93000000-0000-4000-8000-000000000009";
const foreignManagerPersonId = "93000000-0000-4000-8000-000000000021";
const clientCompanyId = "93000000-0000-4000-8000-000000000010";
const networkCompanyId = "93000000-0000-4000-8000-000000000011";
const vendorCompanyId = "93000000-0000-4000-8000-000000000012";
const technicalContactId = "93000000-0000-4000-8000-000000000013";
const networkContactId = "93000000-0000-4000-8000-000000000014";
const vendorContactId = "93000000-0000-4000-8000-000000000015";
const dispatchItemId = "93000000-0000-4000-8000-000000000016";
const missingRecipientItemId = "93000000-0000-4000-8000-000000000017";
const profileId = "93000000-0000-4000-8000-000000000018";
const profileItemId = "93000000-0000-4000-8000-000000000019";
const unprofiledEpisodeId = "93000000-0000-4000-8000-000000000020";
const receiptItemId = "93000000-0000-4000-8000-000000000022";
const rejectionItemId = "93000000-0000-4000-8000-000000000023";
const waiverItemId = "93000000-0000-4000-8000-000000000024";

async function activate(page: Page, activeOrganizationId: string, pathname = `/episodes/${episodeId}`) {
  const response = await page.request.post("/api/organizations/active", { data: { organizationId: activeOrganizationId, pathname } });
  expect(response.status()).toBe(200);
}

async function switchUser(page: Page, userId: string, activeOrganizationId: string) {
  const response = await page.request.post("/api/debug/user", { data: { userId } });
  expect(response.status()).toBe(200);
  await activate(page, activeOrganizationId);
}

test.describe("Delivery manifest permissions and external visibility", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${managerUserId}, 'Delivery Permission Manager', 'delivery-permission-manager@postpilot.test'),
      (${guestUserId}, 'Delivery Permission Guest', 'delivery-permission-guest@postpilot.test'),
      (${foreignGuestUserId}, 'Foreign Delivery Guest', 'foreign-delivery-guest@postpilot.test'),
      (${foreignManagerUserId}, 'Foreign Delivery Manager', 'foreign-delivery-manager@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationId}, 'Delivery Permission Lab', 'delivery-permission-lab'),
      (${foreignOrganizationId}, 'Foreign Delivery Lab', 'foreign-delivery-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${managerUserId}, 'member'),
      (${organizationId}, ${guestUserId}, 'client'),
      (${foreignOrganizationId}, ${foreignGuestUserId}, 'client'),
      (${foreignOrganizationId}, ${foreignManagerUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'delivery_manager', 'Delivery manager', '["manage_shows","manage_episode_manifests","update_delivery_items"]'::jsonb),
      (${organizationId}, 'client', 'Client', '["view_shared_delivery_status"]'::jsonb),
      (${foreignOrganizationId}, 'delivery_manager', 'Delivery manager', '["update_delivery_items"]'::jsonb),
      (${foreignOrganizationId}, 'client', 'Client', '["view_shared_delivery_status"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Delivery Permission Manager', 'delivery-permission-manager@postpilot.test', 'delivery_manager'),
      (${guestPersonId}, ${organizationId}, ${guestUserId}, 'Delivery Permission Guest', 'delivery-permission-guest@postpilot.test', 'client'),
      (${foreignGuestPersonId}, ${foreignOrganizationId}, ${foreignGuestUserId}, 'Foreign Delivery Guest', 'foreign-delivery-guest@postpilot.test', 'client'),
      (${foreignManagerPersonId}, ${foreignOrganizationId}, ${foreignManagerUserId}, 'Foreign Delivery Manager', 'foreign-delivery-manager@postpilot.test', 'delivery_manager')`;
    await sql`insert into crm_companies (id, organization_id, name, type) values
      (${clientCompanyId}, ${organizationId}, 'Delivery Client', 'client'),
      (${networkCompanyId}, ${organizationId}, 'Delivery Network', 'network'),
      (${vendorCompanyId}, ${organizationId}, 'Unrelated Vendor', 'vendor')`;
    await sql`insert into crm_contacts (id, organization_id, company_id, name, email, contact_type) values
      (${technicalContactId}, ${organizationId}, ${clientCompanyId}, 'Technical Delivery Contact', 'delivery@client.test', 'technical_delivery'),
      (${networkContactId}, ${organizationId}, ${networkCompanyId}, 'Network Desk', 'delivery@network.test', 'general'),
      (${vendorContactId}, ${organizationId}, ${vendorCompanyId}, 'Vendor Contact', 'vendor@vendor.test', 'technical_delivery')`;
    await sql`insert into shows (id, organization_id, title, code, network, client_company_id, time_zone) values (${showId}, ${organizationId}, 'Delivery Access Series', 'DAS', 'Delivery Network', ${clientCompanyId}, 'Europe/London')`;
    await sql`insert into show_contacts (organization_id, show_id, contact_id, responsibility, relationship) values (${organizationId}, ${showId}, ${technicalContactId}, 'delivery_qc', 'Delivery recipient')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, 1, 'Shared delivery episode', 'online', 'in_progress')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead) values (${organizationId}, ${episodeId}, ${guestPersonId}, false)`;
    await sql`insert into episode_delivery_manifests (id, organization_id, episode_id, profile_name, specification_url) values (${manifestId}, ${organizationId}, ${episodeId}, 'Network delivery', 'https://internal.example/specification')`;
    await sql`insert into episode_delivery_items (organization_id, episode_delivery_manifest_id, episode_id, component_type, label, required, status, external_url, external_reference, is_externally_shared, qc_result, position) values
      (${organizationId}, ${manifestId}, ${episodeId}, 'master', 'Locked master', true, 'dispatched', 'https://internal.example/unshared', 'INTERNAL-TRANSFER-01', false, 'passed', 1),
      (${organizationId}, ${manifestId}, ${episodeId}, 'captions', 'English captions', true, 'receipt_confirmed', 'https://client.example/captions', 'CLIENT-REF-02', true, 'not_required', 2)`;
    await sql`insert into episode_delivery_items (id, organization_id, episode_delivery_manifest_id, episode_id, component_type, label, required, status, external_url, external_reference, is_externally_shared, recipient_contact_id, requires_external_recipient, qc_result, position) values
      (${dispatchItemId}, ${organizationId}, ${manifestId}, ${episodeId}, 'metadata', 'Dispatch snapshot test', true, 'qc_passed', 'https://client.example/dispatch', 'CLIENT-REF-03', true, ${technicalContactId}, true, 'not_required', 3)`;
    await sql`insert into episode_delivery_items (id, organization_id, episode_delivery_manifest_id, episode_id, component_type, label, required, status, external_url, requires_external_recipient, qc_result, position) values
      (${missingRecipientItemId}, ${organizationId}, ${manifestId}, ${episodeId}, 'textless', 'Missing recipient test', true, 'qc_passed', 'https://client.example/missing-recipient', true, 'not_required', 4)`;
    await sql`insert into episode_delivery_items (id, organization_id, episode_delivery_manifest_id, episode_id, component_type, label, required, status, external_reference, recipient_contact_id, requires_external_recipient, qc_result, position) values
      (${receiptItemId}, ${organizationId}, ${manifestId}, ${episodeId}, 'metadata', 'Receipt permission test', true, 'dispatched', 'RECEIPT-01', ${technicalContactId}, true, 'not_required', 5),
      (${rejectionItemId}, ${organizationId}, ${manifestId}, ${episodeId}, 'master', 'Rejection correction test', true, 'dispatched', 'REJECT-01', ${technicalContactId}, true, 'passed', 6),
      (${waiverItemId}, ${organizationId}, ${manifestId}, ${episodeId}, 'artwork', 'Waiver permission test', true, 'preparing', null, ${technicalContactId}, false, 'not_required', 7)`;
    await sql`insert into delivery_profiles (id, organization_id, client_company_id, network, name) values (${profileId}, ${organizationId}, ${clientCompanyId}, 'Delivery Network', 'Snapshot profile')`;
    await sql`insert into delivery_profile_items (id, organization_id, delivery_profile_id, component_type, label, required, qc_required, position) values (${profileItemId}, ${organizationId}, ${profileId}, 'master', 'Original snapshot master', true, false, 1)`;
    await sql`update shows set delivery_profile_id = ${profileId} where id = ${showId}`;
    // Simulates an episode that predates delivery manifests. Selecting a show
    // profile must never silently create a checklist for this existing row.
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values (${unprofiledEpisodeId}, ${organizationId}, ${seasonId}, 3, 'Pre-manifest episode', 'development', 'not_started')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${guestUserId}, ${foreignGuestUserId}, ${foreignManagerUserId})`;
    await sql.end();
  });

  test("requires a manifest-management capability to create an external share", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const shared = await page.request.post(`/api/episodes/${episodeId}/delivery-manifest/shared`, { data: { personId: guestPersonId } });
    expect(shared.status()).toBe(201);

    await switchUser(page, guestUserId, organizationId);
    const denied = await page.request.post(`/api/episodes/${episodeId}/delivery-manifest/shared`, { data: { personId: guestPersonId } });
    expect(denied.status()).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: expect.stringContaining("Manage episode manifests") });
  });

  test("filters CRM recipients and snapshots the selected contact at dispatch", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const recipients = await page.request.get(`/api/episodes/${episodeId}/delivery-recipients`);
    expect(recipients.status()).toBe(200);
    const recipientBody = await recipients.json();
    expect(recipientBody).toMatchObject({ contacts: expect.arrayContaining([
      expect.objectContaining({ id: technicalContactId, showAssigned: true }),
      expect.objectContaining({ id: networkContactId, companyType: "network" }),
    ]) });
    const recipientIds = recipientBody.contacts.map((contact: { id: string }) => contact.id);
    expect(recipientIds).not.toContain(vendorContactId);

    await sql`update crm_contacts set name = 'Technical Delivery Updated', email = 'updated-delivery@client.test' where id = ${technicalContactId}`;
    const dispatched = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${dispatchItemId}/transition`, { data: { status: "dispatched", reason: "Facility dispatch completed." } });
    expect(dispatched.status()).toBe(200);
    const [item] = await sql`select recipient_name, recipient_email, recipient_snapshot_at from episode_delivery_items where id = ${dispatchItemId}`;
    expect(item).toMatchObject({ recipient_name: "Technical Delivery Updated", recipient_email: "updated-delivery@client.test" });
    expect(item.recipient_snapshot_at).not.toBeNull();
    const notifications = await sql`select person_id, crm_contact_id, recipient_email, title from notifications where organization_id = ${organizationId} order by created_at desc`;
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ person_id: guestPersonId, title: "Delivery dispatched — receipt requested" }),
      expect.objectContaining({ crm_contact_id: technicalContactId, recipient_email: "updated-delivery@client.test", title: "Delivery dispatched — receipt requested" }),
    ]));

    const missingRecipient = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${missingRecipientItemId}/transition`, { data: { status: "dispatched", reason: "This must not dispatch." } });
    expect(missingRecipient.status()).toBe(409);
    await expect(missingRecipient.json()).resolves.toMatchObject({ error: expect.stringContaining("eligible external recipient") });

    await switchUser(page, guestUserId, organizationId);
    const denied = await page.request.get(`/api/episodes/${episodeId}/delivery-recipients`);
    expect(denied.status()).toBe(403);
  });

  test("snapshots delivery-profile requirements for new episodes and prevents duplicate dispatch", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const duplicateDispatch = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${dispatchItemId}/transition`, { data: { status: "dispatched", reason: "This must not dispatch twice." } });
    expect(duplicateDispatch.status()).toBe(409);
    await expect(duplicateDispatch.json()).resolves.toMatchObject({ error: expect.stringContaining("already") });

    const created = await page.request.post("/api/episodes", { data: {
      seasonId, workflowStageId: null, assignedProducerId: null, editorId: null, coloristId: null, soundMixerId: null,
      number: 2, productionCode: "DAS102", title: "Snapshot episode", synopsis: null, status: "development", qcStatus: "not_started",
      airDate: null, lockedCutDate: null, deliveryDeadline: "2026-08-10T17:00:00.000Z", team: [],
    } });
    expect(created.status()).toBe(201);
    const { id: snapshotEpisodeId } = await created.json();
    await sql`update delivery_profile_items set label = 'Changed profile master' where id = ${profileItemId}`;
    const [snapshotItem] = await sql`select label from episode_delivery_items where organization_id = ${organizationId} and episode_id = ${snapshotEpisodeId}`;
    expect(snapshotItem.label).toBe("Original snapshot master");
    await page.goto("/deliveries");
    await expect(page.locator("span", { hasText: "Checklist not set up" })).toBeVisible();
    await expect(page.getByText("S1 · E03 Pre-manifest episode", { exact: true })).toBeVisible();
    const manuallyApplied = await page.request.post(`/api/episodes/${unprofiledEpisodeId}/delivery-manifest/apply`, { data: { deliveryProfileId: profileId, reason: "Delivery requirements are now confirmed." } });
    expect(manuallyApplied.status()).toBe(200);
    const [manuallyAppliedManifest] = await sql`select id from episode_delivery_manifests where organization_id = ${organizationId} and episode_id = ${unprofiledEpisodeId}`;
    expect(manuallyAppliedManifest).toBeTruthy();
  });

  test("allows delivery operations and records rejection recovery activity", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const deniedReceipt = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${receiptItemId}/transition`, { data: { status: "receipt_confirmed", reason: "Network receipt arrived." } });
    expect(deniedReceipt.status()).toBe(200);

    const deniedWaiver = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${waiverItemId}/transition`, { data: { status: "waived", reason: "Contractually waived for this delivery." } });
    expect(deniedWaiver.status()).toBe(200);

    const rejected = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${rejectionItemId}/transition`, { data: { status: "rejected", reason: "Network rejected the slate and requested a correction." } });
    expect(rejected.status()).toBe(200);
    const [correction] = await sql`select id from post_work_orders where organization_id = ${organizationId} and delivery_item_id = ${rejectionItemId} and kind = 'delivery_correction'`;
    expect(correction).toBeTruthy();
    const [rejectionAudit] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${rejectionItemId} order by created_at desc limit 1`;
    expect(rejectionAudit.action).toBe("episode_delivery_item.rejected");
  });

  test("does not allow an authorised user in another tenant to transition this tenant's items", async ({ page }) => {
    await switchUser(page, foreignManagerUserId, foreignOrganizationId);
    const response = await page.request.post(`/api/episodes/${episodeId}/delivery-items/${receiptItemId}/transition`, { data: { status: "rejected", reason: "Cross-tenant attempt." } });
    expect(response.status()).toBe(404);
  });

  test("returns guests only the explicit shared delivery projection", async ({ page }) => {
    await switchUser(page, managerUserId, organizationId);
    const share = await page.request.post(`/api/episodes/${episodeId}/delivery-manifest/shared`, { data: { personId: guestPersonId } });
    expect(share.status()).toBe(201);
    await switchUser(page, guestUserId, organizationId);
    const response = await page.request.get(`/api/episodes/${episodeId}/delivery-manifest/shared`);
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ profileName: "Network delivery" });
    expect(manifest).not.toHaveProperty("specificationUrl");
    expect(manifest.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Locked master", externalUrl: null, externalReference: null }),
      expect.objectContaining({ label: "English captions", externalUrl: "https://client.example/captions", externalReference: "CLIENT-REF-02" }),
    ]));
    expect(JSON.stringify(manifest)).not.toContain("qcResult");
    expect(JSON.stringify(manifest)).not.toContain("rejectionReason");
    expect(JSON.stringify(manifest)).not.toContain("INTERNAL-TRANSFER-01");

    await page.goto(`/episodes/${episodeId}`);
    await expect(page.getByRole("heading", { name: "Network delivery" })).toBeVisible();
    await expect(page.getByText("Shared delivery status")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Budget" })).toHaveCount(0);
    await expect(page.getByText("Internal QC evidence")).toHaveCount(0);
  });

  test("does not reveal a shared manifest across tenants or to an unshared guest", async ({ page }) => {
    await switchUser(page, foreignGuestUserId, foreignOrganizationId);
    const crossTenant = await page.request.get(`/api/episodes/${episodeId}/delivery-manifest/shared`);
    expect(crossTenant.status()).toBe(404);

    await switchUser(page, managerUserId, organizationId);
    const foreignShare = await page.request.post(`/api/episodes/${episodeId}/delivery-manifest/shared`, { data: { personId: foreignGuestPersonId } });
    expect(foreignShare.status()).toBe(404);

    await switchUser(page, managerUserId, organizationId);
    const removed = await page.request.delete(`/api/episodes/${episodeId}/delivery-manifest/shared`, { data: { personId: guestPersonId } });
    expect(removed.status()).toBe(200);
    await switchUser(page, guestUserId, organizationId);
    const unshared = await page.request.get(`/api/episodes/${episodeId}/delivery-manifest/shared`);
    expect(unshared.status()).toBe(404);
  });
});
