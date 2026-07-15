import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for workflow integration tests.");

const sql = postgres(databaseUrl, { prepare: false });

// This fixture intentionally has non-default display names and a short stage
// sequence. The tests exercise saved workflow configuration, not the seed
// workflow or a fixed list of TV-post labels.
const organizationId = "90000000-0000-4000-8000-000000000001";
const workflowId = "90000000-0000-4000-8000-000000000002";
const showId = "90000000-0000-4000-8000-000000000003";
const seasonId = "90000000-0000-4000-8000-000000000004";
const episodeId = "90000000-0000-4000-8000-000000000005";
const mayaPersonId = "90000000-0000-4000-8000-000000000006";
const viewerUserId = "workflow-function-viewer";
const viewerPersonId = "90000000-0000-4000-8000-000000000015";
const editorialStageId = "90000000-0000-4000-8000-000000000007";
const lockStageId = "90000000-0000-4000-8000-000000000008";
const graphicsStageId = "90000000-0000-4000-8000-000000000009";
const deliveryPrepStageId = "90000000-0000-4000-8000-000000000013";
const editorialRuleId = "90000000-0000-4000-8000-000000000010";
const lockRuleId = "90000000-0000-4000-8000-000000000011";
const graphicsRuleId = "90000000-0000-4000-8000-000000000012";
const deliveryPrepRuleId = "90000000-0000-4000-8000-000000000014";

async function activateWorkflowLab(page: Page) {
  const response = await page.request.post("/api/organizations/active", {
    data: { organizationId, pathname: `/episodes/${episodeId}` },
  });
  expect(response.status()).toBe(200);
}

async function openWorkflow(page: Page) {
  await activateWorkflowLab(page);
  await page.goto(`/episodes/${episodeId}`);
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
}

test.describe("Configurable workflow integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'Workflow Function Lab', 'workflow-function-lab')
    `;
    await sql`
      insert into organization_members (organization_id, user_id, role)
      values (${organizationId}, 'user_maya', 'admin')
    `;
    await sql`
      insert into users (id, name, email)
      values (${viewerUserId}, 'Workflow Viewer', 'workflow-viewer@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`
      insert into organization_members (organization_id, user_id, role)
      values (${organizationId}, ${viewerUserId}, 'member')
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role)
      values (${mayaPersonId}, ${organizationId}, 'user_maya', 'Maya Ortiz', 'maya@postpilot.debug', 'post_supervisor')
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role)
      values (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'Workflow Viewer', 'workflow-viewer@postpilot.test', 'post_supervisor')
    `;
    await sql`
      insert into post_workflows (id, organization_id, name, description, is_default)
      values (${workflowId}, ${organizationId}, 'Function lab workflow', 'A disposable custom workflow for automated coverage.', true)
    `;
    await sql`
      insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early)
      values
        (${editorialStageId}, ${organizationId}, ${workflowId}, 'Editorial handoff', 'offline_edit', 1, '#506f68', false, false),
        (${lockStageId}, ${organizationId}, ${workflowId}, 'Creative sign-off', 'picture_lock', 2, '#a66d46', false, false),
        (${deliveryPrepStageId}, ${organizationId}, ${workflowId}, 'Delivery prep', 'delivery_prep', 3, '#66819a', false, false),
        (${graphicsStageId}, ${organizationId}, ${workflowId}, 'Graphics finishing', 'vfx_graphics_titles', 4, '#725f8f', true, true)
    `;
    await sql`
      insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required)
      values
        (${editorialRuleId}, ${organizationId}, ${editorialStageId}, 'post_supervisor', 'Editorial lead approval', 1, true),
        (${lockRuleId}, ${organizationId}, ${lockStageId}, 'post_supervisor', 'Creative gate approval', 1, true),
        (${deliveryPrepRuleId}, ${organizationId}, ${deliveryPrepStageId}, 'post_supervisor', 'Delivery prep approval', 1, true),
        (${graphicsRuleId}, ${organizationId}, ${graphicsStageId}, 'post_supervisor', 'Graphics lead approval', 1, true)
    `;
    await sql`
      insert into shows (id, organization_id, title, code, time_zone)
      values (${showId}, ${organizationId}, 'Workflow Lab Series', 'WFL', 'Europe/London')
    `;
    await sql`
      insert into seasons (id, organization_id, show_id, number, title)
      values (${seasonId}, ${organizationId}, ${showId}, 1, 'Workflow Lab Series · Season 1')
    `;
    await sql`
      insert into episodes (id, organization_id, season_id, workflow_stage_id, number, production_code, title, status, qc_status)
      values (${episodeId}, ${organizationId}, ${seasonId}, ${editorialStageId}, 1, 'WFL101', 'Custom workflow episode', 'development', 'not_started')
    `;
    await sql`
      insert into episode_team_assignments (organization_id, episode_id, person_id, responsibility, is_lead)
      values
        (${organizationId}, ${episodeId}, ${mayaPersonId}, 'post_supervisor', true),
        (${organizationId}, ${episodeId}, ${viewerPersonId}, 'post_supervisor', false)
    `;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from users where id = ${viewerUserId}`;
    await sql.end();
  });

  test("renders the saved custom stage labels and their configured order", async ({ page }) => {
    await openWorkflow(page);

    await expect(page.getByText("Episode journey", { exact: true })).toBeVisible();

    const stages = page.locator('[aria-label="Episode workflow"] button[aria-pressed]');
    await expect(stages).toHaveCount(4);
    await expect(stages.nth(0)).toContainText("Editorial handoff");
    await expect(stages.nth(1)).toContainText("Creative sign-off");
    await expect(stages.nth(2)).toContainText("Delivery prep");
    await expect(stages.nth(3)).toContainText("Graphics finishing");
  });

  test("requires the tenant approval permission even when the user is the selected signer", async ({ page }) => {
    await sql`update episode_team_assignments set is_lead = case when person_id = ${viewerPersonId} then true else false end where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    const assumedViewer = await page.request.post("/api/debug/user", { data: { userId: viewerUserId } });
    expect(assumedViewer.status()).toBe(200);
    await activateWorkflowLab(page);
    const response = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off" } });
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "You do not have permission to approve workflow gates." });
    await sql`update episode_team_assignments set is_lead = case when person_id = ${mayaPersonId} then true else false end where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    const assumedMaya = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(assumedMaya.status()).toBe(200);
  });

  test("requires an explicit workflow signer even when only one person has the role", async ({ page }) => {
    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`update episodes set workflow_stage_id = ${editorialStageId} where id = ${episodeId}`;
    await sql`update episode_team_assignments set is_lead = false where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    const assumedMaya = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(assumedMaya.status()).toBe(200);
    await activateWorkflowLab(page);

    const unsigned = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off" } });
    expect(unsigned.status()).toBe(409);
    await expect(unsigned.json()).resolves.toMatchObject({ error: "Choose the episode workflow signer before this stage can be signed off." });

    await sql`update episode_team_assignments set is_lead = true where organization_id = ${organizationId} and episode_id = ${episodeId} and person_id = ${mayaPersonId}`;
    const signed = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off" } });
    expect(signed.status()).toBe(200);

    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
  });

  test("does not offer stage movement to a signer without episode-management permission", async ({ page }) => {
    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`delete from episode_workflow_tracks where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`update episodes set workflow_stage_id = ${editorialStageId} where id = ${episodeId}`;
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions)
      values (${organizationId}, 'post_supervisor', 'Post Supervisor', ${JSON.stringify(["approve_reviews"])})
      on conflict (organization_id, role) do update set permissions = excluded.permissions
    `;
    await sql`update episode_team_assignments set is_lead = case when person_id = ${viewerPersonId} then true else false end where organization_id = ${organizationId} and episode_id = ${episodeId}`;

    const assumedViewer = await page.request.post("/api/debug/user", { data: { userId: viewerUserId } });
    expect(assumedViewer.status()).toBe(200);
    await openWorkflow(page);
    await page.getByRole("button", { name: "Sign off", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Stage fully signed off.");
    await page.getByRole("button", { name: "Select Creative sign-off", exact: true }).click();
    await expect(page.getByText("This stage is ready. A user with episode-management permission can move the episode forward.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Move episode to Creative sign-off", exact: true })).toHaveCount(0);

    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`update episode_team_assignments set is_lead = case when person_id = ${mayaPersonId} then true else false end where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    const assumedMaya = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(assumedMaya.status()).toBe(200);
  });

  test("updates the workflow view after an authorised user moves the episode", async ({ page }) => {
    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`delete from episode_workflow_tracks where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`update episodes set workflow_stage_id = ${editorialStageId} where id = ${episodeId}`;
    await sql`update episode_team_assignments set is_lead = case when person_id = ${mayaPersonId} then true else false end where organization_id = ${organizationId} and episode_id = ${episodeId}`;

    const assumedMaya = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(assumedMaya.status()).toBe(200);
    await openWorkflow(page);
    await page.getByRole("button", { name: "Sign off", exact: true }).click();
    await page.getByRole("button", { name: "Select Creative sign-off", exact: true }).click();
    await page.getByRole("button", { name: "Move episode to Creative sign-off", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Creative sign-off", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move episode to Creative sign-off", exact: true })).toHaveCount(0);
    const [episode] = await sql`select workflow_stage_id from episodes where id = ${episodeId}`;
    expect(episode.workflow_stage_id).toBe(lockStageId);

    await sql`delete from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId}`;
    await sql`update episodes set workflow_stage_id = ${editorialStageId} where id = ${episodeId}`;
  });

  test("enforces normal stage order and blocks the next stage until the current sign-off is complete", async ({ page }) => {
    await openWorkflow(page);

    await page.getByRole("button", { name: "Select Delivery prep", exact: true }).click();
    await expect(page.getByText("This follows later in the workflow and will unlock in order.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Move episode to Delivery prep", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Select Creative sign-off", exact: true }).click();
    await expect(page.getByText("This is next in the workflow. Complete the current stage sign-off first.")).toBeVisible();
    await expect(page.getByText("Creative gate approval", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move episode to Creative sign-off", exact: true })).toHaveCount(0);
  });

  test("shows the current workflow on Review when it is this user's turn to sign off", async ({ page }) => {
    await activateWorkflowLab(page);
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Awaiting my sign-off" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Editorial handoff" })).toBeVisible();
    await page.getByRole("button", { name: "Sign off", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Editorial handoff" })).not.toBeVisible();

    await openWorkflow(page);
    await page.getByRole("button", { name: "Select Creative sign-off", exact: true }).click();
    await expect(page.getByRole("button", { name: "Move episode to Creative sign-off", exact: true })).toBeEnabled();
  });

  test("preserves completed episode approvals when workflow settings are saved", async ({ page }) => {
    await activateWorkflowLab(page);
    await page.goto("/settings/workflow");

    const earlyStartSwitch = page.getByRole("switch", { name: "Allow Delivery prep to start early" });
    await expect(earlyStartSwitch).not.toBeChecked();
    await earlyStartSwitch.check();
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");
    const approvals = await sql`select id from episode_workflow_approvals where organization_id = ${organizationId} and episode_id = ${episodeId} and approval_rule_id = ${editorialRuleId}`;
    expect(approvals).toHaveLength(1);
  });

  test("starts an explicitly configured stage as a parallel workflow track", async ({ page }) => {
    await activateWorkflowLab(page);
    await page.goto("/settings/workflow");

    await openWorkflow(page);
    await page.getByRole("button", { name: "Select Delivery prep", exact: true }).click();
    await page.getByRole("button", { name: "Move episode to Delivery prep", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Early-start work began in parallel");
    const [episode] = await sql`select workflow_stage_id from episodes where id = ${episodeId}`;
    expect(episode.workflow_stage_id).toBe(editorialStageId);
    const tracks = await sql`select status from episode_workflow_tracks where organization_id = ${organizationId} and episode_id = ${episodeId} and workflow_stage_id = ${deliveryPrepStageId}`;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].status).toBe("in_progress");
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Delivery prep" })).toBeVisible();
    await page.getByRole("button", { name: "Sign off", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Delivery prep" })).not.toBeVisible();
    const [completedTrack] = await sql`select status from episode_workflow_tracks where organization_id = ${organizationId} and episode_id = ${episodeId} and workflow_stage_id = ${deliveryPrepStageId}`;
    expect(completedTrack.status).toBe("approved");
  });

  test("allows a configured early-start stage to begin without a hard-coded workflow dependency", async ({ page }) => {
    await activateWorkflowLab(page);
    const response = await page.request.patch(`/api/episodes/${episodeId}`, { data: { workflowStageId: graphicsStageId } });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, startedEarly: true });
  });

  test("persists renamed stages and early-start settings", async ({ page }) => {
    await activateWorkflowLab(page);
    await page.goto("/settings/workflow");

    await page.getByLabel("Stage name").nth(0).fill("Offline editorial review");
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");

    await page.reload();
    await expect(page.getByLabel("Stage name").nth(0)).toHaveValue("Offline editorial review");
    await expect(page.getByRole("switch", { name: "Allow Delivery prep to start early" })).toBeChecked();
  });

  test("sends a shared-role sign-off only to the episode’s selected signer", async ({ page }) => {
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions)
      values (${organizationId}, 'post_supervisor', 'Post Supervisor', ${JSON.stringify(["approve_reviews"])})
      on conflict (organization_id, role) do update set permissions = excluded.permissions
    `;
    await sql`update episodes set workflow_stage_id = ${graphicsStageId} where id = ${episodeId}`;
    const assumedUser = await page.request.post("/api/debug/user", { data: { userId: viewerUserId } });
    expect(assumedUser.status()).toBe(200);

    await openWorkflow(page);
    await expect(page.getByRole("button", { name: "Sign off", exact: true })).toHaveCount(0);
    await expect(page.getByText("Awaiting sign-off from Maya Ortiz.")).toBeVisible();
  });

  test("lets a manager select the other shared-role episode signer", async ({ page }) => {
    const assumedManager = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(assumedManager.status()).toBe(200);
    await activateWorkflowLab(page);
    const teamResponse = await page.request.get(`/api/episodes/${episodeId}/team`);
    expect(teamResponse.status()).toBe(200);
    const team = await teamResponse.json() as { assignments: Array<{ id: string; personId: string }> };
    const viewerAssignment = team.assignments.find((assignment) => assignment.personId === viewerPersonId);
    expect(viewerAssignment).toBeTruthy();
    const updateSigner = await page.request.patch(`/api/episodes/${episodeId}/team`, { data: { assignmentId: viewerAssignment?.id, isSigner: true } });
    expect(updateSigner.status()).toBe(200);

    const assumedViewer = await page.request.post("/api/debug/user", { data: { userId: viewerUserId } });
    expect(assumedViewer.status()).toBe(200);
    await openWorkflow(page);
    await expect(page.getByRole("button", { name: "Sign off", exact: true })).toBeVisible();
  });

  test("allows a no-gate stage to advance without an approval record", async ({ page }) => {
    await sql`delete from workflow_stage_approval_rules where id = ${deliveryPrepRuleId}`;
    await sql`update episodes set workflow_stage_id = ${deliveryPrepStageId} where id = ${episodeId}`;
    const assumedMaya = await page.request.post("/api/debug/user", { data: { userId: "user_maya" } });
    expect(assumedMaya.status()).toBe(200);
    await activateWorkflowLab(page);
    const response = await page.request.patch(`/api/episodes/${episodeId}`, { data: { workflowStageId: graphicsStageId } });
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, startedEarly: false });
  });
});
