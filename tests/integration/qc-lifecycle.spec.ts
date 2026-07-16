import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for QC lifecycle integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "92000000-0000-4000-8000-000000000001";
const crossOrganizationId = "92000000-0000-4000-8000-000000000002";
const workflowId = "92000000-0000-4000-8000-000000000003";
const stageId = "92000000-0000-4000-8000-000000000004";
const deliveryStageId = "92000000-0000-4000-8000-000000000018";
const qcApprovalRuleId = "92000000-0000-4000-8000-000000000019";
const showId = "92000000-0000-4000-8000-000000000005";
const seasonId = "92000000-0000-4000-8000-000000000006";
const episodeId = "92000000-0000-4000-8000-000000000007";
const qcPersonId = "92000000-0000-4000-8000-000000000008";
const recorderPersonId = "92000000-0000-4000-8000-000000000009";
const editorPersonId = "92000000-0000-4000-8000-000000000010";
const managerPersonId = "92000000-0000-4000-8000-000000000011";
const waiverPersonId = "92000000-0000-4000-8000-000000000016";
const crossShowId = "92000000-0000-4000-8000-000000000012";
const crossSeasonId = "92000000-0000-4000-8000-000000000013";
const crossEpisodeId = "92000000-0000-4000-8000-000000000014";
const crossReportId = "92000000-0000-4000-8000-000000000015";
const crossIssueId = "92000000-0000-4000-8000-000000000017";
const qcUserId = "user_qc_lifecycle_verifier";
const recorderUserId = "user_qc_lifecycle_recorder";
const editorUserId = "user_qc_lifecycle_editor";
const managerUserId = "user_qc_lifecycle_manager";
const waiverUserId = "user_qc_lifecycle_waiver";

async function activateLab(page: Page) {
  const response = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: `/episodes/${episodeId}` } });
  expect(response.status()).toBe(200);
}

async function switchUser(page: Page, userId: string) {
  const response = await page.request.post("/api/debug/user", { data: { userId } });
  expect(response.status()).toBe(200);
  await activateLab(page);
}

test.describe("QC lifecycle integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${crossOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${qcUserId}, 'QC Lifecycle Verifier', 'qc-lifecycle-verifier@postpilot.test'),
      (${recorderUserId}, 'QC Lifecycle Recorder', 'qc-lifecycle-recorder@postpilot.test'),
      (${editorUserId}, 'QC Lifecycle Editor', 'qc-lifecycle-editor@postpilot.test'),
      (${managerUserId}, 'QC Lifecycle Manager', 'qc-lifecycle-manager@postpilot.test'),
      (${waiverUserId}, 'QC Lifecycle Waiver', 'qc-lifecycle-waiver@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug) values
      (${organizationId}, 'QC Lifecycle Lab', 'qc-lifecycle-lab'),
      (${crossOrganizationId}, 'QC Cross-Tenant Lab', 'qc-cross-tenant-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${qcUserId}, 'member'),
      (${organizationId}, ${recorderUserId}, 'member'),
      (${organizationId}, ${editorUserId}, 'member'),
      (${organizationId}, ${managerUserId}, 'member'),
      (${organizationId}, ${waiverUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'qc_verifier', 'QC verifier', '["manage_qc","verify_qc","update_assigned_work"]'::jsonb),
      (${organizationId}, 'qc_recorder', 'QC recorder', '["manage_qc"]'::jsonb),
      (${organizationId}, 'qc_waiver', 'QC waiver', '["manage_qc","waive_qc"]'::jsonb),
      (${organizationId}, 'editor', 'Editor', '["update_assigned_work"]'::jsonb),
      (${organizationId}, 'post_manager', 'Post manager', '["manage_shows"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${qcPersonId}, ${organizationId}, ${qcUserId}, 'QC Lifecycle Verifier', 'qc-lifecycle-verifier@postpilot.test', 'qc_verifier'),
      (${recorderPersonId}, ${organizationId}, ${recorderUserId}, 'QC Lifecycle Recorder', 'qc-lifecycle-recorder@postpilot.test', 'qc_recorder'),
      (${editorPersonId}, ${organizationId}, ${editorUserId}, 'QC Lifecycle Editor', 'qc-lifecycle-editor@postpilot.test', 'editor'),
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'QC Lifecycle Manager', 'qc-lifecycle-manager@postpilot.test', 'post_manager'),
      (${waiverPersonId}, ${organizationId}, ${waiverUserId}, 'QC Lifecycle Waiver', 'qc-lifecycle-waiver@postpilot.test', 'qc_waiver')`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'QC lifecycle workflow', true)`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early, requires_qc_pass) values (${stageId}, ${organizationId}, ${workflowId}, 'Quality control', 'quality_control', 1, '#506f68', false, false, true), (${deliveryStageId}, ${organizationId}, ${workflowId}, 'Delivery', 'delivery', 2, '#506f68', false, false, false)`;
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${qcApprovalRuleId}, ${organizationId}, ${stageId}, 'qc_verifier', 'QC sign-off', 1, true)`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'QC Lifecycle Series', 'QCL', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, editor_id, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, ${stageId}, ${editorPersonId}, 1, 'Re-QC episode', 'online', 'in_progress')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead) values
      (${organizationId}, ${episodeId}, ${qcPersonId}, true),
      (${organizationId}, ${episodeId}, ${recorderPersonId}, false)`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${crossShowId}, ${crossOrganizationId}, 'Isolated QC Series', 'XQC', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${crossSeasonId}, ${crossOrganizationId}, ${crossShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values (${crossEpisodeId}, ${crossOrganizationId}, ${crossSeasonId}, 1, 'Other tenant episode', 'online', 'in_progress')`;
    await sql`insert into qc_reports (id, organization_id, episode_id, status, summary, completed_at) values (${crossReportId}, ${crossOrganizationId}, ${crossEpisodeId}, 'failed', 'Cross tenant report', now())`;
    await sql`insert into qc_issues (id, organization_id, qc_report_id, severity, description) values (${crossIssueId}, ${crossOrganizationId}, ${crossReportId}, 'major', 'Cross tenant issue')`;
  });

  test.beforeEach(async () => {
    await sql`delete from post_work_orders where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`delete from qc_reports where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`delete from activity_log where organization_id = ${organizationId} and entity_id = ${episodeId}`;
    await sql`update episodes set qc_status = 'in_progress', workflow_stage_id = ${stageId} where id = ${episodeId} and organization_id = ${organizationId}`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${crossOrganizationId})`;
    await sql`delete from users where id in (${qcUserId}, ${recorderUserId}, ${editorUserId}, ${managerUserId}, ${waiverUserId})`;
    await sql.end();
  });

  test("requires the dedicated QC permissions rather than show management", async ({ page }) => {
    await switchUser(page, managerUserId);
    const response = await page.request.post("/api/qc-reports", { data: { episodeId, status: "failed", summary: "This must be rejected." } });
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Record QC reports") });

    await switchUser(page, recorderUserId);
    const passed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "Recorder cannot verify." } });
    expect(passed.status()).toBe(403);
    await expect(passed.json()).resolves.toMatchObject({ error: expect.stringContaining("QC verification") });
  });

  test("does not allow the QC workflow stage to be deleted", async ({ page }) => {
    await switchUser(page, managerUserId);

    const response = await page.request.patch(`/api/workflows/${workflowId}`, {
      data: {
        name: "QC lifecycle workflow",
        description: null,
        stages: [
          { id: deliveryStageId, name: "Delivery", key: "delivery", position: 1, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: false },
        ],
        rules: [],
        workOrderTemplates: [],
      },
    });

    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "The QC workflow stage cannot be deleted." });
  });

  test("keeps failed QC in one decision stage and advances only after a passed re-QC", async ({ page }) => {
    await switchUser(page, qcUserId);
    const beforeResult = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, approvalRuleId: qcApprovalRuleId, action: "sign_off" } });
    expect(beforeResult.status()).toBe(409);
    await expect(beforeResult.json()).resolves.toMatchObject({ error: expect.stringContaining("passed or authorised-waived QC") });

    const failed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "failed", summary: "A correction is required." } });
    expect(failed.status()).toBe(201);
    const afterFailure = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, approvalRuleId: qcApprovalRuleId, action: "sign_off" } });
    expect(afterFailure.status()).toBe(409);

    await sql`delete from post_work_orders where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    const reQc = await page.request.post("/api/qc-reports", { data: { episodeId, status: "in_progress", summary: "Corrections are ready for re-QC." } });
    expect(reQc.status()).toBe(201);
    const passed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "Correction verified in re-QC." } });
    expect(passed.status()).toBe(200);
    const signed = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: stageId, approvalRuleId: qcApprovalRuleId, action: "sign_off" } });
    expect(signed.status()).toBe(200);
    await expect(signed.json()).resolves.toMatchObject({ stageComplete: true, advancedTo: { id: deliveryStageId, name: "Delivery" } });
  });

  test("keeps another tenant's QC report outside the current post house", async ({ page }) => {
    await switchUser(page, qcUserId);
    const response = await page.request.post("/api/qc-issues", { data: { qcReportId: crossReportId, severity: "major", description: "Attempt cross-tenant issue." } });
    expect(response.status()).toBe(404);
  });

  test("rejects direct QC report and issue updates aimed at another tenant", async ({ page }) => {
    await switchUser(page, qcUserId);
    const report = await page.request.post("/api/qc-reports", { data: { episodeId: crossEpisodeId, status: "failed", summary: "Attempt cross-tenant report." } });
    expect(report.status()).toBe(404);
    const issue = await page.request.patch(`/api/qc-issues/${crossIssueId}`, { data: { status: "resolved", resolution: "Attempt cross-tenant update." } });
    expect(issue.status()).toBe(404);
  });

  test("validates report and issue payloads before any QC state is changed", async ({ page }) => {
    await switchUser(page, recorderUserId);
    const badUrl = await page.request.post("/api/qc-reports", { data: { episodeId, status: "failed", reportUrl: "not-a-url" } });
    expect(badUrl.status()).toBe(400);
    const missingWaiver = await page.request.post("/api/qc-reports", { data: { episodeId, status: "waived" } });
    expect(missingWaiver.status()).toBe(400);
    const failed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "failed", checksum: "abcdefgh", summary: "A legal-range failure." } });
    expect(failed.status()).toBe(201);
    const reportId = (await failed.json()).id as string;
    const invalidIssue = await page.request.post("/api/qc-issues", { data: { qcReportId: reportId, severity: "major", description: "Negative timecode", timecodeSeconds: -1 } });
    expect(invalidIssue.status()).toBe(400);
    const validIssue = await page.request.post("/api/qc-issues", { data: { qcReportId: reportId, severity: "major", description: "A valid issue." } });
    const issueId = (await validIssue.json()).id as string;
    await switchUser(page, qcUserId);
    const missingResolution = await page.request.patch(`/api/qc-issues/${issueId}`, { data: { status: "resolved" } });
    expect(missingResolution.status()).toBe(400);
    const [stored] = await sql`select checksum from qc_reports where id = ${reportId}`;
    expect(stored.checksum).toBe("abcdefgh");
  });

  test("keeps one active QC run and closes it with a verified pass", async ({ page }) => {
    await switchUser(page, recorderUserId);
    const draft = await page.request.post("/api/qc-reports", { data: { episodeId, status: "draft", summary: "Checklist started." } });
    expect(draft.status()).toBe(201);
    const draftBody = await draft.json();
    const inProgress = await page.request.post("/api/qc-reports", { data: { episodeId, status: "in_progress", summary: "Technical QC underway." } });
    expect(inProgress.status()).toBe(200);
    expect(await inProgress.json()).toMatchObject({ id: draftBody.id, updated: true, status: "in_progress" });
    const reports = await sql`select id, status, completed_at, summary from qc_reports where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    expect(reports).toEqual([{ id: draftBody.id, status: "in_progress", completed_at: null, summary: "Technical QC underway." }]);
    await switchUser(page, qcUserId);
    const passed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "Initial QC passed." } });
    expect(passed.status()).toBe(200);
    const [episode] = await sql`select qc_status from episodes where id = ${episodeId}`;
    expect(episode.qc_status).toBe("passed");
  });

  test("rejects duplicate final QC results and preserves the completed report", async ({ page }) => {
    await switchUser(page, qcUserId);
    const passed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "QC complete." } });
    expect(passed.status()).toBe(201);
    const body = await passed.json();
    const duplicate = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "Accidental repeat." } });
    expect(duplicate.status()).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: expect.stringContaining("already final") });
    const reports = await sql`select id, status, summary from qc_reports where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    expect(reports).toEqual([{ id: body.id, status: "passed", summary: "QC complete." }]);
  });

  test("enforces the waiver permission and makes waivers auditable", async ({ page }) => {
    await switchUser(page, recorderUserId);
    const denied = await page.request.post("/api/qc-reports", { data: { episodeId, status: "waived", waiverReason: "Client accepted the documented exception." } });
    expect(denied.status()).toBe(403);
    await switchUser(page, waiverUserId);
    const waived = await page.request.post("/api/qc-reports", { data: { episodeId, status: "waived", waiverReason: "Client accepted the documented exception." } });
    expect(waived.status()).toBe(201);
    const reportId = (await waived.json()).id as string;
    const [report] = await sql`select waiver_reason, waived_by_person_id, completed_at from qc_reports where id = ${reportId}`;
    expect(report).toMatchObject({ waiver_reason: "Client accepted the documented exception.", waived_by_person_id: waiverPersonId });
    expect(report.completed_at).toBeTruthy();
    const events = await sql`select action from activity_log where organization_id = ${organizationId} and entity_id = ${reportId}`;
    expect(events.map((event) => event.action)).toContain("qc.waived");
  });

  test("waives and reopens individual issues with their linked correction work order", async ({ page }) => {
    await switchUser(page, recorderUserId);
    const failed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "failed", summary: "A correction is required." } });
    const reportId = (await failed.json()).id as string;
    const created = await page.request.post("/api/qc-issues", { data: { qcReportId: reportId, severity: "critical", description: "Critical correction." } });
    const issueId = (await created.json()).id as string;
    const denied = await page.request.patch(`/api/qc-issues/${issueId}`, { data: { status: "waived", resolution: "Not authorised." } });
    expect(denied.status()).toBe(403);
    await switchUser(page, waiverUserId);
    const waived = await page.request.patch(`/api/qc-issues/${issueId}`, { data: { status: "waived", resolution: "Accepted by production." } });
    expect(waived.status()).toBe(200);
    const [workOrder] = await sql`select status from post_work_orders where organization_id = ${organizationId} and qc_issue_id = ${issueId}`;
    expect(workOrder.status).toBe("cancelled");
    await switchUser(page, recorderUserId);
    const reopened = await page.request.patch(`/api/qc-issues/${issueId}`, { data: { status: "open" } });
    expect(reopened.status()).toBe(200);
    const [reopenedWorkOrder] = await sql`select status from post_work_orders where organization_id = ${organizationId} and qc_issue_id = ${issueId}`;
    expect(reopenedWorkOrder.status).toBe("open");
  });

  test("requires issue corrections and QC verification before a passed re-QC", async ({ page }) => {
    await switchUser(page, qcUserId);
    const failed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "failed", summary: "A flash frame needs correction." } });
    expect(failed.status()).toBe(201);
    const qcReportId = (await failed.json()).id as string;

    const issueResponse = await page.request.post("/api/qc-issues", { data: { qcReportId, severity: "major", code: "FLASH-001", description: "Flash frame at 00:12:07.", timecodeSeconds: 727 } });
    expect(issueResponse.status()).toBe(201);
    const issueId = (await issueResponse.json()).id as string;
    const [linkedIssueWorkOrder] = await sql`select id, qc_issue_id, assignee_person_id, is_blocking, status from post_work_orders where qc_issue_id = ${issueId}`;
    expect(linkedIssueWorkOrder).toMatchObject({ qc_issue_id: issueId, assignee_person_id: editorPersonId, is_blocking: true, status: "open" });

    const reQc = await page.request.post("/api/qc-reports", { data: { episodeId, status: "in_progress", summary: "Re-QC started after correction." } });
    expect(reQc.status()).toBe(201);
    const blockedPass = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "This should remain blocked." } });
    expect(blockedPass.status()).toBe(409);
    await expect(blockedPass.json()).resolves.toMatchObject({ error: expect.stringContaining("Resolve or waive") });

    const genericRows = await sql`select id from post_work_orders where organization_id = ${organizationId} and episode_id = ${episodeId} and kind = 'qc_exception' and qc_issue_id is null`;
    expect(genericRows).toHaveLength(1);
    const genericWorkOrderId = genericRows[0].id as string;

    await switchUser(page, editorUserId);
    expect((await page.request.patch(`/api/work-orders/${genericWorkOrderId}`, { data: { status: "ready_for_review" } })).status()).toBe(200);
    expect((await page.request.patch(`/api/work-orders/${linkedIssueWorkOrder.id}`, { data: { status: "ready_for_review" } })).status()).toBe(200);

    await switchUser(page, qcUserId);
    expect((await page.request.patch(`/api/work-orders/${genericWorkOrderId}`, { data: { status: "complete" } })).status()).toBe(200);
    expect((await page.request.patch(`/api/work-orders/${linkedIssueWorkOrder.id}`, { data: { status: "complete" } })).status()).toBe(200);
    const [issue] = await sql`select status, resolution from qc_issues where id = ${issueId}`;
    expect(issue).toMatchObject({ status: "resolved", resolution: "Verified through linked QC correction work order." });

    const passed = await page.request.post("/api/qc-reports", { data: { episodeId, status: "passed", summary: "Re-QC verified after correction." } });
    expect(passed.status()).toBe(200);
    const [episode] = await sql`select qc_status from episodes where id = ${episodeId}`;
    expect(episode.qc_status).toBe("passed");
  });

  test("renders the QC workspace, records a failure, and exposes the issue form", async ({ page }) => {
    await switchUser(page, recorderUserId);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole("button", { name: "QC", exact: true }).click();
    await expect(page.getByText("No QC report has been recorded for this episode yet.")).toBeVisible();
    await expect(page.getByText("No QC exceptions have been logged.")).toBeVisible();
    await page.getByLabel("Result").selectOption("failed");
    await page.getByLabel(/Summary/).fill("Flash frame found during browser QC.");
    await page.getByRole("button", { name: "Record QC result", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("QC failure recorded");
    await expect(page.getByText("Latest report · failed")).toBeVisible();
    const issueDescription = page.getByLabel("Exception description");
    await issueDescription.fill("Correct the flash frame before re-QC.");
    await expect(issueDescription).toHaveValue("Correct the flash frame before re-QC.");
    const logIssue = page.getByRole("button", { name: "Log exception", exact: true });
    await expect(logIssue).toBeEnabled();
    await logIssue.click();
    await expect(page.getByText("QC issue logged.", { exact: true })).toBeVisible();
    await expect(page.getByText("Correct the flash frame before re-QC.")).toBeVisible();
  });

  test("shows only the QC controls granted to the current user", async ({ page }) => {
    await switchUser(page, recorderUserId);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole("button", { name: "QC", exact: true }).click();
    await expect(page.getByRole("option", { name: /Passed — verified re-QC/ })).toHaveCount(0);
    await expect(page.getByText("Verify QC")).toBeVisible();
    await switchUser(page, managerUserId);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole("button", { name: "QC", exact: true }).click();
    await expect(page.getByText("you can view QC history, but your current role cannot record QC results.", { exact: false })).toBeVisible();
  });

  test("creates and deletes an unused workflow stage", async ({ page }) => {
    const temporaryStageId = "92000000-0000-4000-8000-000000000020";
    await switchUser(page, managerUserId);

    const add = await page.request.patch(`/api/workflows/${workflowId}`, {
      data: {
        name: "QC lifecycle workflow",
        description: null,
        stages: [
          { id: stageId, name: "Quality control", key: "quality_control", position: 1, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: true },
          { id: deliveryStageId, name: "Delivery", key: "delivery", position: 2, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: false },
          { id: temporaryStageId, name: "Archive preparation", key: "archive_preparation", position: 3, color: "#687a78", isTerminal: false, canStartEarly: false, requiresQcPass: false },
        ],
        rules: [
          { id: qcApprovalRuleId, workflowStageId: stageId, approverRole: "qc_verifier", label: "QC sign-off", approvalOrder: 1, isRequired: true },
        ],
        workOrderTemplates: [],
      },
    });
    expect(add.status()).toBe(200);
    expect(await sql`select id from workflow_stages where id = ${temporaryStageId}`).toHaveLength(1);

    const remove = await page.request.patch(`/api/workflows/${workflowId}`, {
      data: {
        name: "QC lifecycle workflow",
        description: null,
        stages: [
          { id: stageId, name: "Quality control", key: "quality_control", position: 1, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: true },
          { id: deliveryStageId, name: "Delivery", key: "delivery", position: 2, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: false },
        ],
        rules: [
          { id: qcApprovalRuleId, workflowStageId: stageId, approverRole: "qc_verifier", label: "QC sign-off", approvalOrder: 1, isRequired: true },
        ],
        workOrderTemplates: [],
      },
    });
    expect(remove.status()).toBe(200);
    expect(await sql`select id from workflow_stages where id = ${temporaryStageId}`).toHaveLength(0);
  });
});
