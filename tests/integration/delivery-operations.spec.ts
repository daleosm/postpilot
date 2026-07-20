import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for delivery operations tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "93400000-0000-4000-8000-000000000001";
const foreignOrganizationId = "93400000-0000-4000-8000-000000000002";
const workflowId = "93400000-0000-4000-8000-000000000003";
const facilityStageId = "93400000-0000-4000-8000-000000000004";
const acceptanceStageId = "93400000-0000-4000-8000-000000000005";
const showId = "93400000-0000-4000-8000-000000000006";
const seasonId = "93400000-0000-4000-8000-000000000007";
const gateEpisodeId = "93400000-0000-4000-8000-000000000008";
const lifecycleEpisodeId = "93400000-0000-4000-8000-000000000009";
const gateManifestId = "93400000-0000-4000-8000-000000000010";
const lifecycleManifestId = "93400000-0000-4000-8000-000000000011";
const gateItemId = "93400000-0000-4000-8000-000000000012";
const lifecycleItemId = "93400000-0000-4000-8000-000000000013";
const managerPersonId = "93400000-0000-4000-8000-000000000014";
const clientPersonId = "93400000-0000-4000-8000-000000000015";
const contactId = "93400000-0000-4000-8000-000000000016";
const companyId = "93400000-0000-4000-8000-000000000017";
const foreignPersonId = "93400000-0000-4000-8000-000000000018";
const managerUserId = "delivery-operations-manager";
const clientUserId = "delivery-operations-client";
const foreignUserId = "delivery-operations-foreign";

async function assume(page: Page, userId: string, activeOrganizationId = organizationId, episodeId = gateEpisodeId) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId: activeOrganizationId, pathname: `/episodes/${episodeId}` } })).status()).toBe(200);
}

async function transition(page: Page, episodeId: string, itemId: string, status: string, extra: Record<string, unknown> = {}) {
  return page.request.post(`/api/episodes/${episodeId}/delivery-items/${itemId}/transition`, { data: { status, reason: `Move item to ${status}.`, ...extra } });
}

test.describe("Delivery checklist operations", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${managerUserId}, 'Delivery Operations Manager', 'delivery-operations-manager@test.local'),
      (${clientUserId}, 'Delivery Operations Client', 'delivery-operations-client@test.local'),
      (${foreignUserId}, 'Foreign Delivery Operations', 'delivery-operations-foreign@test.local')
      on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Delivery Operations Lab', 'delivery-operations-lab'), (${foreignOrganizationId}, 'Foreign Delivery Operations Lab', 'foreign-delivery-operations-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${managerUserId}, 'member'), (${organizationId}, ${clientUserId}, 'client'), (${foreignOrganizationId}, ${foreignUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'delivery_operator', 'Delivery operator', '["manage_production","do_assigned_work","manage_qc_delivery"]'::jsonb),
      (${organizationId}, 'client', 'Client', '[]'::jsonb),
      (${foreignOrganizationId}, 'delivery_operator', 'Delivery operator', '["manage_qc_delivery"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Delivery Operations Manager', 'delivery-operations-manager@test.local', 'delivery_operator'),
      (${clientPersonId}, ${organizationId}, ${clientUserId}, 'Delivery Operations Client', 'delivery-operations-client@test.local', 'client'),
      (${foreignPersonId}, ${foreignOrganizationId}, ${foreignUserId}, 'Foreign Delivery Operations', 'delivery-operations-foreign@test.local', 'delivery_operator')`;
    await sql`insert into crm_companies (id, organization_id, name, type) values (${companyId}, ${organizationId}, 'Delivery Operations Network', 'network')`;
    await sql`insert into crm_contacts (id, organization_id, company_id, name, email, contact_type) values (${contactId}, ${organizationId}, ${companyId}, 'Network Delivery Desk', 'delivery@operations.test', 'technical_delivery')`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'Delivery operations workflow', true)`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, delivery_gate) values
      (${facilityStageId}, ${organizationId}, ${workflowId}, 'Facility delivery', 'facility_delivery', 1, '#506f68', false, 'facility_dispatch'),
      (${acceptanceStageId}, ${organizationId}, ${workflowId}, 'Client acceptance', 'client_acceptance', 2, '#66819a', true, 'client_acceptance')`;
    await sql`insert into shows (id, organization_id, title, code, client_company_id, network, time_zone) values (${showId}, ${organizationId}, 'Delivery Operations Show', 'DOS', ${companyId}, 'Delivery Operations Network', 'Europe/London')`;
    await sql`insert into show_contacts (organization_id, show_id, contact_id, responsibility, relationship) values (${organizationId}, ${showId}, ${contactId}, 'delivery_qc', 'Network delivery desk')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, workflow_status, number, title, status, qc_status) values
      (${gateEpisodeId}, ${organizationId}, ${seasonId}, ${facilityStageId}, 'not_started', 1, 'Gate episode', 'development', 'not_started'),
      (${lifecycleEpisodeId}, ${organizationId}, ${seasonId}, ${facilityStageId}, 'not_started', 2, 'Lifecycle episode', 'development', 'not_started')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id) values
      (${organizationId}, ${gateEpisodeId}, ${managerPersonId}), (${organizationId}, ${gateEpisodeId}, ${clientPersonId}), (${organizationId}, ${lifecycleEpisodeId}, ${managerPersonId})`;
    await sql`insert into episode_delivery_manifests (id, organization_id, episode_id, profile_name) values
      (${gateManifestId}, ${organizationId}, ${gateEpisodeId}, 'Network delivery'), (${lifecycleManifestId}, ${organizationId}, ${lifecycleEpisodeId}, 'Network delivery')`;
    await sql`insert into episode_delivery_items (id, organization_id, episode_delivery_manifest_id, episode_id, component_type, label, required, recipient_contact_id, requires_external_recipient, qc_required, qc_result, status, position) values
      (${gateItemId}, ${organizationId}, ${gateManifestId}, ${gateEpisodeId}, 'master', 'ProRes master', true, ${contactId}, true, true, 'passed', 'qc_passed', 1),
      (${lifecycleItemId}, ${organizationId}, ${lifecycleManifestId}, ${lifecycleEpisodeId}, 'captions', 'English captions', true, ${contactId}, true, true, 'not_started', 'not_started', 1)`;
  });

  test("persists the full delivery lifecycle and rejects duplicate dispatch", async ({ page }) => {
    await assume(page, managerUserId, organizationId, lifecycleEpisodeId);
    expect((await transition(page, lifecycleEpisodeId, lifecycleItemId, "preparing")).status()).toBe(200);
    expect((await transition(page, lifecycleEpisodeId, lifecycleItemId, "ready_for_qc")).status()).toBe(200);
    expect((await transition(page, lifecycleEpisodeId, lifecycleItemId, "qc_passed")).status()).toBe(200);
    expect((await transition(page, lifecycleEpisodeId, lifecycleItemId, "dispatched", { externalReference: "PORTAL-101", submissionMethod: "Signiant" })).status()).toBe(200);
    const duplicate = await transition(page, lifecycleEpisodeId, lifecycleItemId, "dispatched", { externalReference: "PORTAL-101" });
    expect(duplicate.status()).toBe(409);
    expect((await transition(page, lifecycleEpisodeId, lifecycleItemId, "receipt_confirmed", { receiptConfirmedBy: "Network delivery desk" })).status()).toBe(200);
    expect(await sql`select status, qc_result, external_reference, submission_method, submitted_by_person_id, submitted_at, receipt_confirmed_at from episode_delivery_items where id = ${lifecycleItemId}`).toEqual([expect.objectContaining({ status: "receipt_confirmed", qc_result: "passed", external_reference: "PORTAL-101", submission_method: "Signiant", submitted_by_person_id: managerPersonId, submitted_at: expect.any(Date), receipt_confirmed_at: expect.any(Date) })]);
    expect(await sql`select count(*)::int as count from activity_log where organization_id = ${organizationId} and entity_id = ${lifecycleItemId}`).toEqual([{ count: 5 }]);
  });

  test("enforces facility dispatch and receipt gates, with only an authorised acceptance exception", async ({ page }) => {
    await assume(page, managerUserId);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}`, { data: { workflowStageId: facilityStageId, action: "start" } })).status()).toBe(200);
    const blockedDispatch = await page.request.post(`/api/episodes/${gateEpisodeId}`, { data: { workflowStageId: facilityStageId, action: "submit" } });
    expect(blockedDispatch.status()).toBe(409);
    await expect(blockedDispatch.json()).resolves.toMatchObject({ error: expect.stringContaining("not dispatched") });
    expect((await transition(page, gateEpisodeId, gateItemId, "dispatched", { externalReference: "PORTAL-100" })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}`, { data: { workflowStageId: facilityStageId, action: "submit" } })).status()).toBe(200);
    expect(await sql`select workflow_stage_id, workflow_status from episodes where id = ${gateEpisodeId}`).toEqual([{ workflow_stage_id: acceptanceStageId, workflow_status: "not_started" }]);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}`, { data: { workflowStageId: acceptanceStageId, action: "start" } })).status()).toBe(200);
    const blockedReceipt = await page.request.post(`/api/episodes/${gateEpisodeId}`, { data: { workflowStageId: acceptanceStageId, action: "submit" } });
    expect(blockedReceipt.status()).toBe(409);
    await assume(page, clientUserId);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}/delivery-acceptance-exception`, { data: { workflowStageId: acceptanceStageId, reason: "Client cannot authorise exceptions." } })).status()).toBe(403);
    await assume(page, managerUserId);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}/delivery-acceptance-exception`, { data: { workflowStageId: facilityStageId, reason: "This is the wrong workflow stage." } })).status()).toBe(409);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}/delivery-acceptance-exception`, { data: { workflowStageId: acceptanceStageId, reason: "Network has confirmed receipt outside the portal." } })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${gateEpisodeId}`, { data: { workflowStageId: acceptanceStageId, action: "submit" } })).status()).toBe(200);
    expect(await sql`select workflow_status from episodes where id = ${gateEpisodeId}`).toEqual([{ workflow_status: "complete" }]);
  });

  test("creates, changes, and removes audited episode-specific delivery overrides", async ({ page }) => {
    await assume(page, managerUserId, organizationId, lifecycleEpisodeId);
    const added = await page.request.post(`/api/episodes/${lifecycleEpisodeId}/delivery-items`, { data: { componentType: "metadata", label: "Metadata sheet", required: true, recipientContactId: contactId, requiresExternalRecipient: true, qcRequired: false, dueDate: "2026-08-15", reason: "Network added a metadata requirement." } });
    expect(added.status()).toBe(201);
    const { item } = await added.json();
    expect((await page.request.patch(`/api/episodes/${lifecycleEpisodeId}/delivery-items/${item.id}`, { data: { position: 1, reason: "This must not displace the existing captions item." } })).status()).toBe(409);
    const updated = await page.request.patch(`/api/episodes/${lifecycleEpisodeId}/delivery-items/${item.id}`, { data: { dueDate: "2026-08-16", reason: "Network delivery desk moved the due date." } });
    expect(updated.status(), await updated.text()).toBe(200);
    expect((await page.request.delete(`/api/episodes/${lifecycleEpisodeId}/delivery-items/${item.id}`, { data: { reason: "Network withdrew this metadata requirement." } })).status()).toBe(200);
    expect(await sql`select count(*)::int as count from activity_log where organization_id = ${organizationId} and entity_id = ${item.id} and action in ('episode_delivery_item.added', 'episode_delivery_item.changed', 'episode_delivery_item.removed')`).toEqual([{ count: 3 }]);
  });

  test("keeps clients and foreign tenants out of delivery mutations", async ({ page }) => {
    await assume(page, clientUserId, organizationId, lifecycleEpisodeId);
    expect((await page.request.post(`/api/episodes/${lifecycleEpisodeId}/delivery-items`, { data: { componentType: "master", label: "Client addition", required: true, reason: "Client should not add items." } })).status()).toBe(403);
    expect((await page.request.get(`/api/episodes/${lifecycleEpisodeId}/delivery-recipients`)).status()).toBe(403);
    await assume(page, foreignUserId, foreignOrganizationId, lifecycleEpisodeId);
    expect((await transition(page, lifecycleEpisodeId, lifecycleItemId, "rejected")).status()).toBe(404);
    expect((await page.request.post(`/api/episodes/${lifecycleEpisodeId}/delivery-acceptance-exception`, { data: { workflowStageId: acceptanceStageId, reason: "Foreign users must not authorise this." } })).status()).toBe(404);
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${clientUserId}, ${foreignUserId})`;
    await sql.end();
  });
});
