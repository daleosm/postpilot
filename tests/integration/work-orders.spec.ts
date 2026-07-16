import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for work-order integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "91000000-0000-4000-8000-000000000001";
const workflowId = "91000000-0000-4000-8000-000000000002";
const stageId = "91000000-0000-4000-8000-000000000003";
const ruleId = "91000000-0000-4000-8000-000000000004";
const showId = "91000000-0000-4000-8000-000000000005";
const seasonId = "91000000-0000-4000-8000-000000000006";
const episodeId = "91000000-0000-4000-8000-000000000007";
const mayaPersonId = "91000000-0000-4000-8000-000000000008";
const qcPersonId = "91000000-0000-4000-8000-000000000009";
const editorPersonId = "91000000-0000-4000-8000-000000000010";
const coordinatorPersonId = "91000000-0000-4000-8000-000000000011";
const vendorCompanyId = "91000000-0000-4000-8000-000000000012";
const clientCompanyId = "91000000-0000-4000-8000-000000000013";
const roomId = "91000000-0000-4000-8000-000000000014";
const otherEpisodeId = "91000000-0000-4000-8000-000000000015";
const otherBookingId = "91000000-0000-4000-8000-000000000016";
const laterStageId = "91000000-0000-4000-8000-000000000017";
const foreignOrganizationId = "91000000-0000-4000-8000-000000000018";
const foreignWorkflowId = "91000000-0000-4000-8000-000000000019";
const foreignStageId = "91000000-0000-4000-8000-000000000020";
const foreignShowId = "91000000-0000-4000-8000-000000000021";
const foreignSeasonId = "91000000-0000-4000-8000-000000000022";
const foreignEpisodeId = "91000000-0000-4000-8000-000000000023";
const foreignWorkOrderId = "91000000-0000-4000-8000-000000000024";
const alternateWorkflowId = "91000000-0000-4000-8000-000000000025";
const alternateStageId = "91000000-0000-4000-8000-000000000026";
const qcUserId = "user_work_order_qc";
const editorUserId = "user_work_order_editor";
const coordinatorUserId = "user_work_order_coordinator";

async function activateLab(page: Page) {
  const response = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: `/episodes/${episodeId}` } });
  expect(response.status()).toBe(200);
}

async function switchDebugUser(page: Page, userId: string) {
  const response = await page.request.post("/api/debug/user", { data: { userId } });
  expect(response.status()).toBe(200);
  await activateLab(page);
}

test.describe("Post work orders integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values (${qcUserId}, 'QC Lab Operator', 'qc-lab@postpilot.test'), (${editorUserId}, 'Editorial Lab Operator', 'editor-lab@postpilot.test'), (${coordinatorUserId}, 'Operations Lab Coordinator', 'coordinator-lab@postpilot.test') on conflict (id) do update set name = excluded.name`;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Work Order Lab', 'work-order-lab'), (${foreignOrganizationId}, 'Foreign Work Order Lab', 'foreign-work-order-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, 'user_maya', 'admin'), (${organizationId}, ${qcUserId}, 'member'), (${organizationId}, ${editorUserId}, 'member'), (${organizationId}, ${coordinatorUserId}, 'member')`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values (${mayaPersonId}, ${organizationId}, 'user_maya', 'Maya Ortiz', 'maya@postpilot.debug', 'post_supervisor'), (${qcPersonId}, ${organizationId}, ${qcUserId}, 'QC Lab Operator', 'qc-lab@postpilot.test', 'quality_verifier'), (${editorPersonId}, ${organizationId}, ${editorUserId}, 'Editorial Lab Operator', 'editor-lab@postpilot.test', 'editor'), (${coordinatorPersonId}, ${organizationId}, ${coordinatorUserId}, 'Operations Lab Coordinator', 'coordinator-lab@postpilot.test', 'operations_coordinator')`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'Work order test workflow', true), (${alternateWorkflowId}, ${organizationId}, 'Alternate work order workflow', false), (${foreignWorkflowId}, ${foreignOrganizationId}, 'Foreign work order workflow', true)`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early) values (${stageId}, ${organizationId}, ${workflowId}, 'QC verification', 'quality_control', 1, '#506f68', false, false), (${laterStageId}, ${organizationId}, ${workflowId}, 'Delivery handoff', 'delivery_handoff', 2, '#506f68', false, false), (${alternateStageId}, ${organizationId}, ${alternateWorkflowId}, 'Alternate stage', 'alternate_stage', 1, '#506f68', false, false), (${foreignStageId}, ${foreignOrganizationId}, ${foreignWorkflowId}, 'Foreign stage', 'foreign_stage', 1, '#506f68', false, false)`;
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${ruleId}, ${organizationId}, ${stageId}, 'post_supervisor', 'Post Supervisor sign-off', 1, true)`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values (${organizationId}, 'post_supervisor', 'Post supervisor', '["manage_work_orders","approve_work_orders","manage_shows","manage_budget"]'::jsonb), (${organizationId}, 'editor', 'Editor', '["update_assigned_work"]'::jsonb), (${organizationId}, 'quality_verifier', 'QC verifier', '["update_assigned_work","verify_qc","approve_work_orders"]'::jsonb), (${organizationId}, 'operations_coordinator', 'Operations coordinator', '["manage_work_orders"]'::jsonb)`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values (${vendorCompanyId}, ${organizationId}, 'Lab Finishing Vendor', 'vendor', 'GBP'), (${clientCompanyId}, ${organizationId}, 'Lab Network Client', 'client', 'GBP')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Work Order Lab Series', 'WOL', 'Europe/London'), (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Work Order Series', 'FWOL', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1), (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, ${stageId}, 1, 'Correction test', 'online', 'needs_attention'), (${otherEpisodeId}, ${organizationId}, ${seasonId}, ${stageId}, 2, 'Other correction test', 'online', 'needs_attention'), (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, ${foreignStageId}, 1, 'Foreign correction test', 'online', 'needs_attention')`;
    await sql`insert into rooms (id, organization_id, name, type) values (${roomId}, ${organizationId}, 'Lab Online', 'online')`;
    await sql`insert into bookings (id, organization_id, room_id, episode_id, title, starts_at, ends_at, status, booking_type) values (${otherBookingId}, ${organizationId}, ${roomId}, ${otherEpisodeId}, 'Other episode online', '2035-02-01T09:00:00.000Z', '2035-02-01T12:00:00.000Z', 'confirmed', 'conform')`;
    await sql`insert into post_work_orders (id, organization_id, episode_id, workflow_stage_id, title) values (${foreignWorkOrderId}, ${foreignOrganizationId}, ${foreignEpisodeId}, ${foreignStageId}, 'Foreign work order')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead) values (${organizationId}, ${episodeId}, ${mayaPersonId}, true)`;
  });

  test.beforeEach(async () => {
    await sql`delete from budget_lines where organization_id = ${organizationId}`;
    await sql`delete from billables where organization_id = ${organizationId}`;
    await sql`delete from vendor_invoices where organization_id = ${organizationId}`;
    await sql`delete from activity_log where organization_id = ${organizationId} and entity_type = 'post_work_order'`;
    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`delete from post_work_orders where organization_id = ${organizationId}`;
    await sql`update episodes set workflow_stage_id = ${stageId} where organization_id = ${organizationId} and id = ${episodeId}`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id = ${qcUserId}`;
    await sql`delete from users where id = ${editorUserId}`;
    await sql`delete from users where id = ${coordinatorUserId}`;
    await sql.end();
  });

  test("makes stage-linked work orders blocking by default", async ({ page }) => {
    await switchDebugUser(page, "user_maya");
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Resolve legal burn-in", priority: "blocker" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    const [workOrder] = await sql`select is_blocking from post_work_orders where id = ${workOrderId}`;
    expect(workOrder.is_blocking).toBe(true);

    const signOff = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, action: "sign_off" } });
    expect(signOff.status()).toBe(409);
    await expect(signOff.json()).resolves.toMatchObject({ error: expect.stringContaining("blocking work order") });

    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);
    await switchDebugUser(page, qcUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress" } })).status()).toBe(200);
    await switchDebugUser(page, "user_maya");
    const complete = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(complete.status()).toBe(200);
    const permittedSignOff = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, action: "sign_off" } });
    expect(permittedSignOff.status()).toBe(200);
  });

  test("stores a tenant-scoped service, material, and expense breakdown on a work order", async ({ page }) => {
    await switchDebugUser(page, "user_maya");
    const create = await page.request.post("/api/work-orders", { data: {
      episodeId, workflowStageId: stageId, title: "Localisation correction package",
      items: [
        { type: "service", description: "Subtitle timing correction", quantity: 3, unit: "hour", unitRate: 85, discountPercent: 0 },
        { type: "material", description: "Client review drive", quantity: 1, unit: "unit", unitRate: 12.5, discountPercent: 0 },
        { type: "expense", description: "Secure delivery transfer", quantity: 1, unit: "fixed", unitRate: 18, discountPercent: 0 },
      ],
    } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    const items = await sql`select type, description, quantity, unit, unit_rate from post_work_order_items where organization_id = ${organizationId} and work_order_id = ${workOrderId} order by position`;
    expect(items).toEqual([
      { type: "service", description: "Subtitle timing correction", quantity: "3.00", unit: "hour", unit_rate: "85.00" },
      { type: "material", description: "Client review drive", quantity: "1.00", unit: "unit", unit_rate: "12.50" },
      { type: "expense", description: "Secure delivery transfer", quantity: "1.00", unit: "fixed", unit_rate: "18.00" },
    ]);

    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { items: [{ type: "service", description: "Corrected subtitle package", quantity: 4, unit: "hour", unitRate: 85, discountPercent: 10 }] } })).status()).toBe(200);
    const afterUpdate = await sql`select description, quantity, discount_percent from post_work_order_items where organization_id = ${organizationId} and work_order_id = ${workOrderId}`;
    expect(afterUpdate).toEqual([{ description: "Corrected subtitle package", quantity: "4.00", discount_percent: "10.000" }]);

    await switchDebugUser(page, coordinatorUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { items: [{ type: "expense", description: "Unapproved entry", quantity: 1, unit: "fixed", unitRate: 5, discountPercent: 0 }] } })).status()).toBe(403);
  });

  test("routes QC exceptions through re-QC and only lets QC close them", async ({ page }) => {
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, kind: "qc_exception", title: "Correct flash frame", assigneePersonId: editorPersonId, priority: "blocker", isBlocking: true } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;

    const switchEditor = await page.request.post("/api/debug/user", { data: { userId: editorUserId } });
    expect(switchEditor.status()).toBe(200);
    const invalidClose = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(invalidClose.status()).toBe(403);
    await expect(invalidClose.json()).resolves.toMatchObject({ error: expect.stringContaining("QC verification permission") });

    const handOff = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "ready_for_review" } });
    expect(handOff.status()).toBe(200);
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: qcUserId } });
    expect(switchUser.status()).toBe(200);
    const qcClose = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(qcClose.status()).toBe(200);
  });

  test("lets a Budget user post a completed client change without an accounts approval state", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Client-requested alternate title card", billingScope: "billable_change", clientQuoteAmount: 750, clientQuoteCurrency: "USD" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;

    const beforeCompletion = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: 800, category: "Graphics" } });
    expect(beforeCompletion.status()).toBe(409);

    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);
    await switchDebugUser(page, qcUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress" } })).status()).toBe(200);
    await switchDebugUser(page, "user_maya");
    const complete = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(complete.status()).toBe(200);
    const [readyToPost] = await sql`select billing_status from post_work_orders where id = ${workOrderId}`;
    expect(readyToPost).toMatchObject({ billing_status: "draft" });
    const postCharge = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: 800, category: "Graphics", reference: "CO-104" } });
    expect(postCharge.status()).toBe(201);
    const [budgetLine] = await sql`select work_order_id, budgeted_amount, actual_amount, cost_type from budget_lines where work_order_id = ${workOrderId}`;
    expect(budgetLine).toMatchObject({ work_order_id: workOrderId, budgeted_amount: "750.00", actual_amount: "800.00", cost_type: "billable" });

    const duplicate = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: 800 } });
    expect(duplicate.status()).toBe(409);
  });

  test("stores vendor estimates and client billable quotes separately in the post-house currency", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: {
      episodeId, workflowStageId: stageId, title: "External versioning change", vendorCompanyId,
      billingScope: "billable_change", estimatedAmount: 450, currency: "GBP", clientQuoteAmount: 900, clientQuoteCurrency: "USD",
    } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    const [workOrder] = await sql`select estimated_amount, currency, client_quote_amount, client_quote_currency from post_work_orders where id = ${workOrderId}`;
    expect(workOrder).toMatchObject({ estimated_amount: "450.00", currency: "GBP", client_quote_amount: "900.00", client_quote_currency: "GBP" });
  });

  test("lets an operational manager flag a client change but keeps its price with Budget", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: coordinatorUserId } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);

    const commercialAttempt = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Unapproved client change", billingScope: "billable_change", clientQuoteAmount: 500, clientQuoteCurrency: "USD" } });
    expect(commercialAttempt.status()).toBe(403);
    await expect(commercialAttempt.json()).resolves.toMatchObject({ error: expect.stringContaining("Budget permission") });

    const operationalCreate = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Prepare external caption brief" } });
    expect(operationalCreate.status()).toBe(201);
    const workOrderId = (await operationalCreate.json()).id as string;

    const commercialUpdate = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { billingScope: "billable_change" } });
    expect(commercialUpdate.status()).toBe(200);
  });

  test("rejects cross-tenant work-order routes and referenced resources", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);

    const foreignCreate = await page.request.post("/api/work-orders", { data: { episodeId: foreignEpisodeId, workflowStageId: foreignStageId, title: "Cross-tenant request" } });
    expect(foreignCreate.status()).toBe(404);

    const foreignUpdate = await page.request.patch(`/api/work-orders/${foreignWorkOrderId}`, { data: { status: "complete" } });
    expect(foreignUpdate.status()).toBe(404);
    const foreignCharge = await page.request.post(`/api/work-orders/${foreignWorkOrderId}/charge`, { data: { actualAmount: 100 } });
    expect(foreignCharge.status()).toBe(404);
  });

  test("keeps work-order references coherent within one post house", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);

    const otherEpisodeBooking = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, bookingId: otherBookingId, title: "Wrong episode booking" } });
    expect(otherEpisodeBooking.status()).toBe(409);
    await expect(otherEpisodeBooking.json()).resolves.toMatchObject({ error: "Booking must belong to this episode." });

    const wrongVendorType = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, vendorCompanyId: clientCompanyId, title: "Client cannot be a vendor" } });
    expect(wrongVendorType.status()).toBe(400);
    await expect(wrongVendorType.json()).resolves.toMatchObject({ error: "Select a vendor account for external work." });

    const wrongWorkflow = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: alternateStageId, title: "Wrong workflow stage" } });
    expect(wrongWorkflow.status()).toBe(409);
    await expect(wrongWorkflow.json()).resolves.toMatchObject({ error: "Workflow stage does not belong to this episode's workflow." });
  });

  test("requires independent approval before an assigned artist can start work", async ({ page }) => {
    const switchManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchManager.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, assigneePersonId: editorPersonId, title: "Prepare turnover notes" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;

    const switchEditor = await page.request.post("/api/debug/user", { data: { userId: editorUserId } });
    expect(switchEditor.status()).toBe(200);
    const directCompletion = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(directCompletion.status()).toBe(403);

    const restoreManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(restoreManager.status()).toBe(200);
    await activateLab(page);
    const submit = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } });
    expect(submit.status()).toBe(200);
    const selfApproval = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress" } });
    expect(selfApproval.status()).toBe(403);
    await switchDebugUser(page, qcUserId);
    const approve = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress", approvalNote: "Approved for editorial turnover." } });
    expect(approve.status()).toBe(200);
    const restoreEditor = await page.request.post("/api/debug/user", { data: { userId: editorUserId } });
    expect(restoreEditor.status()).toBe(200);
    const completion = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(completion.status()).toBe(200);
    const [audit] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${workOrderId} and action = 'work_order.completed'`;
    expect(audit).toBeTruthy();
    const [approvalAudit] = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${workOrderId} and action = 'work_order.approved'`;
    expect(approvalAudit).toBeTruthy();
  });

  test("lets an approver return a submitted work order for revision and resubmission", async ({ page }) => {
    await switchDebugUser(page, coordinatorUserId);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Clarify network graphics request" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);

    await switchDebugUser(page, "user_maya");
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "rejected", approvalNote: "Add the network reference before release." } })).status()).toBe(200);
    const [returned] = await sql`select status, approval_note from post_work_orders where id = ${workOrderId}`;
    expect(returned).toMatchObject({ status: "rejected", approval_note: "Add the network reference before release." });

    await switchDebugUser(page, coordinatorUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { title: "Clarify network graphics request — reference added" } })).status()).toBe(200);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);
  });

  test("keeps creation and updates out of unassigned artists' authority", async ({ page }) => {
    const switchManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchManager.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, assigneePersonId: mayaPersonId, title: "Producer-only request" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;

    const switchEditor = await page.request.post("/api/debug/user", { data: { userId: editorUserId } });
    expect(switchEditor.status()).toBe(200);
    const createAttempt = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Artist-created request" } });
    expect(createAttempt.status()).toBe(403);
    const updateAttempt = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(updateAttempt.status()).toBe(403);
  });

  test("protects budget posting and keeps invalid charges out of commercial records", async ({ page }) => {
    const switchManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchManager.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Client title revision", billingScope: "billable_change", clientQuoteAmount: 750 } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);
    await switchDebugUser(page, qcUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress" } })).status()).toBe(200);
    await switchDebugUser(page, "user_maya");
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } })).status()).toBe(200);

    const switchCoordinator = await page.request.post("/api/debug/user", { data: { userId: coordinatorUserId } });
    expect(switchCoordinator.status()).toBe(200);
    const forbidden = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: 750 } });
    expect(forbidden.status()).toBe(403);

    const restoreManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(restoreManager.status()).toBe(200);
    await activateLab(page);
    const invalid = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: -1 } });
    expect(invalid.status()).toBe(400);
    const [beforeBudget] = await sql`select id from budget_lines where organization_id = ${organizationId} and work_order_id = ${workOrderId}`;
    const [beforeBillable] = await sql`select id from billables where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    expect(beforeBudget).toBeUndefined();
    expect(beforeBillable).toBeUndefined();

    const posted = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: 800, reference: "CO-105" } });
    expect(posted.status()).toBe(201);
    const lockedCommercialTerms = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { clientQuoteAmount: 900 } });
    expect(lockedCommercialTerms.status()).toBe(409);
    const [billable] = await sql`select amount, currency, reference from billables where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    expect(billable).toMatchObject({ amount: "800.00", currency: "GBP", reference: "CO-105" });
  });

  test("shows role-assigned approved work in the artist's assigned-work queue", async ({ page }) => {
    const switchManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchManager.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, assigneeRole: "editor", title: "Role-assigned editorial check" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);
    await switchDebugUser(page, qcUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress" } })).status()).toBe(200);

    const switchEditor = await page.request.post("/api/debug/user", { data: { userId: editorUserId } });
    expect(switchEditor.status()).toBe(200);
    await activateLab(page);
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "My assigned work" })).toBeVisible();
    await expect(page.getByText("Role-assigned editorial check", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByText("Work order completed.", { exact: true })).toBeVisible();
  });

  test("shows a manager the contextual work-order form and creates a draft from it", async ({ page }) => {
    const switchManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchManager.status()).toBe(200);
    await activateLab(page);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole("button", { name: "Work orders", exact: true }).click();
    await expect(page.getByText("No work orders for this episode yet.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New work order", exact: true }).click();
    await expect(page.getByLabel("Estimated vendor cost")).not.toBeVisible();
    await page.getByLabel("Vendor (optional)").selectOption(vendorCompanyId);
    await expect(page.getByLabel("Estimated vendor cost")).toBeVisible();
    await page.getByLabel("Work type").selectOption("billable_change");
    await expect(page.getByLabel("Quoted client change")).toBeVisible();
    await page.getByLabel("Title").fill("UI-created work order");
    await page.getByLabel("Estimated vendor cost").fill("240");
    await page.getByLabel("Quoted client change").fill("480");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Work order saved as draft.", { exact: true })).toBeVisible();
    await expect(page.getByText("UI-created work order", { exact: true })).toBeVisible();
  });

  test("records a vendor invoice as the actual cost of approved external work", async ({ page }) => {
    const switchManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchManager.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, vendorCompanyId, estimatedAmount: 450, title: "External subtitle conform" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "awaiting_approval" } })).status()).toBe(200);
    await switchDebugUser(page, qcUserId);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "in_progress" } })).status()).toBe(200);
    await switchDebugUser(page, "user_maya");
    const invoice = await page.request.post("/api/vendor-invoices", { data: { vendorCompanyId, episodeId, workOrderId, invoiceNumber: "LFS-104", amount: 512.4, status: "received" } });
    expect(invoice.status()).toBe(201);
    const [workOrder] = await sql`select actual_amount from post_work_orders where organization_id = ${organizationId} and id = ${workOrderId}`;
    const [line] = await sql`select actual_amount, cost_type from budget_lines where organization_id = ${organizationId} and vendor_invoice_id is not null`;
    expect(workOrder).toMatchObject({ actual_amount: "512.40" });
    expect(line).toMatchObject({ actual_amount: "512.40", cost_type: "internal" });
  });

  test("creates each configured stage checklist item only once", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);
    await sql`insert into workflow_stage_work_order_templates (organization_id, workflow_stage_id, title, priority, is_blocking, position) values (${organizationId}, ${laterStageId}, 'Prepare delivery manifest', 'high', true, 1)`;

    const signOff = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, action: "sign_off" } });
    expect(signOff.status()).toBe(200);
    const advance = await page.request.patch(`/api/episodes/${episodeId}`, { data: { workflowStageId: laterStageId } });
    expect(advance.status()).toBe(200);
    const repeat = await page.request.patch(`/api/episodes/${episodeId}`, { data: { workflowStageId: laterStageId } });
    expect(repeat.status()).toBe(200);
    const rows = await sql`select id from post_work_orders where organization_id = ${organizationId} and episode_id = ${episodeId} and workflow_stage_id = ${laterStageId} and title = 'Prepare delivery manifest'`;
    expect(rows).toHaveLength(1);
  });
});
