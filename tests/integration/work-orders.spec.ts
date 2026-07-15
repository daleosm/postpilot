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
const qcUserId = "user_work_order_qc";
const editorUserId = "user_work_order_editor";
const coordinatorUserId = "user_work_order_coordinator";

async function activateLab(page: Page) {
  const response = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: `/episodes/${episodeId}` } });
  expect(response.status()).toBe(200);
}

test.describe("Post work orders integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`insert into users (id, name, email) values (${qcUserId}, 'QC Lab Operator', 'qc-lab@postpilot.test'), (${editorUserId}, 'Editorial Lab Operator', 'editor-lab@postpilot.test'), (${coordinatorUserId}, 'Operations Lab Coordinator', 'coordinator-lab@postpilot.test') on conflict (id) do update set name = excluded.name`;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Work Order Lab', 'work-order-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, 'user_maya', 'admin'), (${organizationId}, ${qcUserId}, 'member'), (${organizationId}, ${editorUserId}, 'member'), (${organizationId}, ${coordinatorUserId}, 'member')`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values (${mayaPersonId}, ${organizationId}, 'user_maya', 'Maya Ortiz', 'maya@postpilot.debug', 'post_supervisor'), (${qcPersonId}, ${organizationId}, ${qcUserId}, 'QC Lab Operator', 'qc-lab@postpilot.test', 'quality_verifier'), (${editorPersonId}, ${organizationId}, ${editorUserId}, 'Editorial Lab Operator', 'editor-lab@postpilot.test', 'editor'), (${coordinatorPersonId}, ${organizationId}, ${coordinatorUserId}, 'Operations Lab Coordinator', 'coordinator-lab@postpilot.test', 'operations_coordinator')`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'Work order test workflow', true)`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early) values (${stageId}, ${organizationId}, ${workflowId}, 'QC verification', 'quality_control', 1, '#506f68', false, false)`;
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${ruleId}, ${organizationId}, ${stageId}, 'post_supervisor', 'Post Supervisor sign-off', 1, true)`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values (${organizationId}, 'post_supervisor', 'Post supervisor', '["manage_work_orders","approve_reviews","manage_shows","manage_budget"]'::jsonb), (${organizationId}, 'editor', 'Editor', '["update_assigned_work"]'::jsonb), (${organizationId}, 'quality_verifier', 'QC verifier', '["update_assigned_work","verify_qc"]'::jsonb), (${organizationId}, 'operations_coordinator', 'Operations coordinator', '["manage_work_orders"]'::jsonb)`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values (${vendorCompanyId}, ${organizationId}, 'Lab Finishing Vendor', 'vendor', 'GBP')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Work Order Lab Series', 'WOL', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, ${stageId}, 1, 'Correction test', 'online', 'needs_attention')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, responsibility, is_lead) values (${organizationId}, ${episodeId}, ${mayaPersonId}, 'post_supervisor', true)`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from users where id = ${qcUserId}`;
    await sql`delete from users where id = ${editorUserId}`;
    await sql`delete from users where id = ${coordinatorUserId}`;
    await sql.end();
  });

  test("makes stage-linked work orders blocking by default", async ({ page }) => {
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Resolve legal burn-in", priority: "blocker" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;
    const [workOrder] = await sql`select is_blocking from post_work_orders where id = ${workOrderId}`;
    expect(workOrder.is_blocking).toBe(true);

    const signOff = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, action: "sign_off" } });
    expect(signOff.status()).toBe(409);
    await expect(signOff.json()).resolves.toMatchObject({ error: expect.stringContaining("blocking work order") });

    const complete = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(complete.status()).toBe(200);
    const permittedSignOff = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, action: "sign_off" } });
    expect(permittedSignOff.status()).toBe(200);
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

  test("requires finance confirmation before a completed client change reaches the episode budget", async ({ page }) => {
    const switchUser = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(switchUser.status()).toBe(200);
    await activateLab(page);
    const create = await page.request.post("/api/work-orders", { data: { episodeId, workflowStageId: stageId, title: "Client-requested alternate title card", billingScope: "billable_change", clientQuoteAmount: 750, clientQuoteCurrency: "USD" } });
    expect(create.status()).toBe(201);
    const workOrderId = (await create.json()).id as string;

    const beforeCompletion = await page.request.post(`/api/work-orders/${workOrderId}/charge`, { data: { actualAmount: 800, category: "Graphics" } });
    expect(beforeCompletion.status()).toBe(409);

    const complete = await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { status: "complete" } });
    expect(complete.status()).toBe(200);
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

  test("keeps commercial fields out of an operational work-order manager's authority", async ({ page }) => {
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
    expect(commercialUpdate.status()).toBe(403);
    await expect(commercialUpdate.json()).resolves.toMatchObject({ error: expect.stringContaining("Budget permission") });
  });
});
