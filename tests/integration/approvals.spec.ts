import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for approvals integration tests.");

const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "91000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "91000000-0000-4000-8000-000000000002";
const workflowId = "91000000-0000-4000-8000-000000000003";
const foreignWorkflowId = "91000000-0000-4000-8000-000000000004";
const stageId = "91000000-0000-4000-8000-000000000005";
const nextStageId = "91000000-0000-4000-8000-000000000006";
const foreignStageId = "91000000-0000-4000-8000-000000000007";
const optionalEditorRuleId = "91000000-0000-4000-8000-000000000008";
const requiredEditorRuleId = "91000000-0000-4000-8000-000000000009";
const requiredProducerRuleId = "91000000-0000-4000-8000-000000000010";
const showOneId = "91000000-0000-4000-8000-000000000011";
const showTwoId = "91000000-0000-4000-8000-000000000012";
const emptyShowId = "91000000-0000-4000-8000-000000000013";
const seasonOneId = "91000000-0000-4000-8000-000000000014";
const seasonTwoId = "91000000-0000-4000-8000-000000000015";
const episodeOneId = "91000000-0000-4000-8000-000000000016";
const episodeTwoId = "91000000-0000-4000-8000-000000000017";
const foreignShowId = "91000000-0000-4000-8000-000000000018";
const foreignSeasonId = "91000000-0000-4000-8000-000000000019";
const foreignEpisodeId = "91000000-0000-4000-8000-000000000020";
const editorUserId = "approvals-lab-editor";
const producerUserId = "approvals-lab-producer";
const editorPersonId = "91000000-0000-4000-8000-000000000021";
const producerPersonId = "91000000-0000-4000-8000-000000000022";
const mayaPersonId = "91000000-0000-4000-8000-000000000023";

async function assume(page: Page, userId: string) {
  const response = await page.request.post("/api/debug/user", { data: { userId } });
  expect(response.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/review" } });
  expect(tenant.status()).toBe(200);
}

async function resetEpisode() {
  await sql`delete from episode_workflow_approvals where organization_id = ${organizationId}`;
  await sql`delete from activity_log where organization_id = ${organizationId} and entity_id in (${episodeOneId}, ${episodeTwoId})`;
  await sql`update episodes set workflow_stage_id = ${stageId} where organization_id = ${organizationId}`;
}

test.describe("Approvals integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`
      insert into organizations (id, name, slug) values
        (${organizationId}, 'Approval Function Lab', 'approval-function-lab'),
        (${foreignOrganizationId}, 'Approval Foreign Lab', 'approval-foreign-lab')
    `;
    await sql`
      insert into users (id, name, email) values
        (${editorUserId}, 'Erin Editor', 'erin.editor@approvals.test'),
        (${producerUserId}, 'Priya Producer', 'priya.producer@approvals.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`
      insert into organization_members (organization_id, user_id, role) values
        (${organizationId}, 'user_maya', 'admin'),
        (${organizationId}, ${editorUserId}, 'member'),
        (${organizationId}, ${producerUserId}, 'member')
    `;
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions) values
        (${organizationId}, 'editor', 'Editor', ${JSON.stringify(["approve_reviews"])}),
        (${organizationId}, 'producer', 'Producer', ${JSON.stringify(["approve_reviews"])}),
        (${organizationId}, 'post_supervisor', 'Post Supervisor', ${JSON.stringify(["manage_shows", "approve_reviews"])})
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role) values
        (${mayaPersonId}, ${organizationId}, 'user_maya', 'Maya Ortiz', 'maya@postpilot.debug', 'post_supervisor'),
        (${editorPersonId}, ${organizationId}, ${editorUserId}, 'Erin Editor', 'erin.editor@approvals.test', 'editor'),
        (${producerPersonId}, ${organizationId}, ${producerUserId}, 'Priya Producer', 'priya.producer@approvals.test', 'producer')
    `;
    await sql`
      insert into post_workflows (id, organization_id, name, is_default) values
        (${workflowId}, ${organizationId}, 'Approval lab workflow', true),
        (${foreignWorkflowId}, ${foreignOrganizationId}, 'Foreign workflow', true)
    `;
    await sql`
      insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early) values
        (${stageId}, ${organizationId}, ${workflowId}, 'Editorial approvals', 'editorial_approvals', 1, '#506f68', false, false),
        (${nextStageId}, ${organizationId}, ${workflowId}, 'Finishing', 'finishing', 2, '#66819a', true, false),
        (${foreignStageId}, ${foreignOrganizationId}, ${foreignWorkflowId}, 'Foreign stage', 'foreign_stage', 1, '#725f8f', true, false)
    `;
    await sql`
      insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values
        (${optionalEditorRuleId}, ${organizationId}, ${stageId}, 'editor', 'Editorial note', 1, false),
        (${requiredEditorRuleId}, ${organizationId}, ${stageId}, 'editor', 'Editor sign-off', 2, true),
        (${requiredProducerRuleId}, ${organizationId}, ${stageId}, 'producer', 'Producer sign-off', 3, true)
    `;
    await sql`
      insert into shows (id, organization_id, title, code, time_zone) values
        (${showOneId}, ${organizationId}, 'Approval Lab One', 'APL1', 'Europe/London'),
        (${showTwoId}, ${organizationId}, 'Approval Lab Two', 'APL2', 'Europe/London'),
        (${emptyShowId}, ${organizationId}, 'Approval Lab Empty', 'APLE', 'Europe/London'),
        (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Approval Show', 'FAS', 'Europe/London')
    `;
    await sql`
      insert into seasons (id, organization_id, show_id, number, title) values
        (${seasonOneId}, ${organizationId}, ${showOneId}, 1, 'Approval Lab One · S1'),
        (${seasonTwoId}, ${organizationId}, ${showTwoId}, 1, 'Approval Lab Two · S1'),
        (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1, 'Foreign Approval Show · S1')
    `;
    await sql`
      insert into episodes (id, organization_id, season_id, workflow_stage_id, number, production_code, title, status, qc_status) values
        (${episodeOneId}, ${organizationId}, ${seasonOneId}, ${stageId}, 1, 'APL101', 'Optional gates', 'development', 'not_started'),
        (${episodeTwoId}, ${organizationId}, ${seasonTwoId}, ${stageId}, 1, 'APL201', 'Scoped queue', 'development', 'not_started'),
        (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, ${foreignStageId}, 1, 'FAS101', 'Foreign episode', 'development', 'not_started')
    `;
    await sql`
      insert into episode_team_assignments (organization_id, episode_id, person_id, responsibility, is_lead) values
        (${organizationId}, ${episodeOneId}, ${editorPersonId}, 'editor', false),
        (${organizationId}, ${episodeOneId}, ${producerPersonId}, 'producer', false),
        (${organizationId}, ${episodeTwoId}, ${editorPersonId}, 'editor', false),
        (${organizationId}, ${episodeTwoId}, ${producerPersonId}, 'producer', false)
    `;
  });

  test.beforeEach(async () => {
    await resetEpisode();
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${editorUserId}, ${producerUserId})`;
    await sql.end();
  });

  test("keeps optional sign-offs non-blocking while enforcing ordered required sign-offs", async ({ page }) => {
    await assume(page, editorUserId);

    const optional = await page.request.post(`/api/episodes/${episodeOneId}`, { data: { workflowStageId: stageId, approvalRuleId: optionalEditorRuleId, action: "sign_off" } });
    expect(optional.status()).toBe(200);
    await expect(optional.json()).resolves.toMatchObject({ stageComplete: false, approvalRuleId: optionalEditorRuleId });

    await assume(page, "user_maya");
    const advanceEarly = await page.request.patch(`/api/episodes/${episodeOneId}`, { data: { workflowStageId: nextStageId } });
    expect(advanceEarly.status()).toBe(409);

    await assume(page, editorUserId);
    const editor = await page.request.post(`/api/episodes/${episodeOneId}`, { data: { workflowStageId: stageId, approvalRuleId: requiredEditorRuleId, action: "sign_off" } });
    expect(editor.status()).toBe(200);
    await expect(editor.json()).resolves.toMatchObject({ stageComplete: false, approvalRuleId: requiredEditorRuleId });

    await assume(page, producerUserId);
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Editorial approvals" })).toBeVisible();
    await expect(page.getByText("Producer sign-off · Step 3 · Required")).toBeVisible();
    await page.getByRole("button", { name: "Sign off", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Editorial approvals" })).not.toBeVisible();

    await assume(page, "user_maya");
    const advance = await page.request.patch(`/api/episodes/${episodeOneId}`, { data: { workflowStageId: nextStageId } });
    expect(advance.status()).toBe(200);
  });

  test("records comments and rejects a repeated sign-off without duplicating the audit trail", async ({ page }) => {
    await assume(page, editorUserId);
    const response = await page.request.post(`/api/episodes/${episodeOneId}`, { data: { workflowStageId: stageId, approvalRuleId: requiredEditorRuleId, action: "sign_off", comment: "Editorial timing checked." } });
    expect(response.status()).toBe(200);

    const duplicate = await page.request.post(`/api/episodes/${episodeOneId}`, { data: { workflowStageId: stageId, approvalRuleId: requiredEditorRuleId, action: "sign_off" } });
    expect(duplicate.status()).toBe(409);

    const [approval] = await sql`select status, comment from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeOneId} and approval_rule_id = ${requiredEditorRuleId}`;
    expect(approval).toMatchObject({ status: "approved", comment: "Editorial timing checked." });
    const events = await sql`select metadata from activity_log where organization_id = ${organizationId} and entity_id = ${episodeOneId} and action = 'workflow.signed_off'`;
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ approvalRuleId: requiredEditorRuleId, comment: "Editorial timing checked." });
  });

  test("deduplicates concurrent sign-off requests for the same workflow gate", async ({ page }) => {
    await assume(page, editorUserId);
    const body = { workflowStageId: stageId, approvalRuleId: requiredEditorRuleId, action: "sign_off" };
    const responses = await Promise.all([
      page.request.post(`/api/episodes/${episodeOneId}`, { data: body }),
      page.request.post(`/api/episodes/${episodeOneId}`, { data: body }),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const approvals = await sql`select id from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeOneId} and approval_rule_id = ${requiredEditorRuleId}`;
    const events = await sql`select id from activity_log where organization_id = ${organizationId} and entity_id = ${episodeOneId} and action = 'workflow.signed_off'`;
    expect(approvals).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  test("scopes the approval queue to the active show and renders an empty scoped inbox", async ({ page }) => {
    await assume(page, editorUserId);

    const selectSecondShow = await page.request.post("/api/active-show", { data: { showId: showTwoId } });
    expect(selectSecondShow.status()).toBe(200);
    await page.goto("/review");
    await expect(page.getByText("Approval Lab Two · E01 Scoped queue")).toHaveCount(2);
    await expect(page.getByText("Approval Lab One · E01 Optional gates")).not.toBeVisible();

    const selectEmptyShow = await page.request.post("/api/active-show", { data: { showId: emptyShowId } });
    expect(selectEmptyShow.status()).toBe(200);
    await page.goto("/review");
    await expect(page.getByText("No workflow stages are waiting for your sign-off.")).toBeVisible();
  });

  test("rejects a direct sign-off request for an episode in another tenant", async ({ page }) => {
    await assume(page, editorUserId);
    const response = await page.request.post(`/api/episodes/${foreignEpisodeId}`, { data: { workflowStageId: foreignStageId, action: "sign_off" } });
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Episode not found." });
  });

  test("persists the required toggle and editable workflow configuration", async ({ page }) => {
    await assume(page, "user_maya");
    await page.goto("/settings/workflow");
    const requiredEditor = page.getByRole("checkbox", { name: "Require sign-off 2" });
    await expect(requiredEditor).toBeChecked();
    await requiredEditor.uncheck();

    const signOffRoles = page.locator('select[aria-label^="Sign-off role"]');
    await expect(signOffRoles).toHaveCount(3);
    await page.getByRole("button", { name: "Add sign-off", exact: true }).first().click();
    await expect(signOffRoles).toHaveCount(4);
    await page.getByRole("button", { name: "Remove sign-off 4", exact: true }).click();
    await expect(signOffRoles).toHaveCount(3);

    await page.evaluate(() => {
      const source = document.querySelector<HTMLButtonElement>('[aria-label="Drag to reorder Finishing"]');
      if (!source) throw new Error("Workflow drag handle was not rendered.");
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const target = document.querySelector<HTMLButtonElement>('[aria-label="Drag to reorder Editorial approvals"]');
      if (!target) throw new Error("Workflow drop target was not rendered.");
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: new DataTransfer() }));
    });
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");
    const [rule] = await sql`select is_required from workflow_stage_approval_rules where id = ${requiredEditorRuleId}`;
    expect(rule.is_required).toBe(false);
    const positions = await sql`select key, position from workflow_stages where organization_id = ${organizationId} order by position`;
    expect(positions.map((stage) => stage.key)).toEqual(["finishing", "editorial_approvals"]);
  });
});
