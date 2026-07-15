import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for workflow functionality tests.");

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

test.describe("Configurable workflow functionality", () => {
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
      values (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'Workflow Viewer', 'workflow-viewer@postpilot.test', 'editor')
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

  test("allows an explicitly configured stage to start early", async ({ page }) => {
    await activateWorkflowLab(page);
    await page.goto("/settings/workflow");

    const earlyStartSwitch = page.getByRole("switch", { name: "Allow Delivery prep to start early" });
    await expect(earlyStartSwitch).not.toBeChecked();
    await earlyStartSwitch.check();
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");

    await openWorkflow(page);
    await page.getByRole("button", { name: "Select Delivery prep", exact: true }).click();
    await page.getByRole("button", { name: "Move episode to Delivery prep", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow stage updated.");
  });

  test("allows a configured early-start stage to begin without a hard-coded workflow dependency", async ({ page }) => {
    await activateWorkflowLab(page);
    const response = await page.request.patch(`/api/episodes/${episodeId}`, { data: { workflowStageId: graphicsStageId } });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
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

  test("shows the sign-off form only to the user with the next configured sign-off role", async ({ page }) => {
    const assumedUser = await page.request.post("/api/debug/user", { data: { userId: viewerUserId } });
    expect(assumedUser.status()).toBe(200);

    await openWorkflow(page);
    await expect(page.getByRole("button", { name: "Sign off", exact: true })).toHaveCount(0);
    await expect(page.getByText("Awaiting sign-off from Graphics lead approval.")).toBeVisible();
  });
});
