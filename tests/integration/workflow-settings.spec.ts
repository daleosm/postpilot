import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for workflow settings integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "93000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "93000000-0000-4000-8000-000000000002";
const emptyOrganizationId = "93000000-0000-4000-8000-000000000003";
const workflowId = "93000000-0000-4000-8000-000000000004";
const foreignWorkflowId = "93000000-0000-4000-8000-000000000005";
const editorialStageId = "93000000-0000-4000-8000-000000000006";
const qcStageId = "93000000-0000-4000-8000-000000000007";
const deliveryStageId = "93000000-0000-4000-8000-000000000008";
const foreignStageId = "93000000-0000-4000-8000-000000000009";
const seasonId = "93000000-0000-4000-8000-000000000010";
const showId = "93000000-0000-4000-8000-000000000011";
const editorialEpisodeId = "93000000-0000-4000-8000-000000000012";
const templateEpisodeId = "93000000-0000-4000-8000-000000000013";
const managerPersonId = "93000000-0000-4000-8000-000000000014";
const viewerPersonId = "93000000-0000-4000-8000-000000000015";
const foreignManagerPersonId = "93000000-0000-4000-8000-000000000016";
const emptyManagerPersonId = "93000000-0000-4000-8000-000000000017";
const editorialRuleId = "93000000-0000-4000-8000-000000000018";
const deliveryRuleId = "93000000-0000-4000-8000-000000000019";

const managerUserId = "workflow-settings-manager";
const viewerUserId = "workflow-settings-viewer";

type StagePayload = {
  id: string;
  name: string;
  key: string;
  position: number;
  color: string;
  isTerminal: boolean;
  canStartEarly: boolean;
  requiresQcPass: boolean;
  deliveryGate: "none" | "dispatch" | "receipt";
};

function baseStages(): StagePayload[] {
  return [
    { id: editorialStageId, name: "Editorial handoff", key: "editorial_handoff", position: 1, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: false, deliveryGate: "none" },
    { id: qcStageId, name: "Quality control", key: "quality_control", position: 2, color: "#506f68", isTerminal: false, canStartEarly: false, requiresQcPass: true, deliveryGate: "none" },
    { id: deliveryStageId, name: "Delivery", key: "delivery", position: 3, color: "#66819a", isTerminal: true, canStartEarly: false, requiresQcPass: false, deliveryGate: "none" },
  ];
}

function baseRules() {
  return [
    { id: editorialRuleId, workflowStageId: editorialStageId, approverRole: "workflow_manager", label: "Workflow manager sign-off", approvalOrder: 1, isRequired: true },
  ];
}

function workflowPayload(overrides: Partial<{ stages: StagePayload[]; rules: Array<{ id?: string; workflowStageId: string; approverRole: string; label: string; approvalOrder: number; isRequired: boolean }>; workOrderTemplates: Array<{ id?: string; workflowStageId: string; title: string; description: string | null; department: string | null; assigneeRole: string | null; priority: "blocker" | "high" | "normal" | "low"; isBlocking: boolean; position: number }> }> = {}) {
  return {
    name: "Settings lab workflow",
    description: "Workflow configuration coverage.",
    stages: overrides.stages ?? baseStages(),
    rules: overrides.rules ?? baseRules(),
    workOrderTemplates: overrides.workOrderTemplates ?? [],
  };
}

async function assume(page: Page, userId: string, activeOrganizationId: string) {
  const debugUser = await page.request.post("/api/debug/user", { data: { userId } });
  expect(debugUser.status()).toBe(200);
  const activeOrganization = await page.request.post("/api/organizations/active", { data: { organizationId: activeOrganizationId, pathname: "/settings/workflow" } });
  expect(activeOrganization.status()).toBe(200);
}

async function resetFixture() {
  await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId}, ${emptyOrganizationId})`;
  await sql`insert into users (id, name, email) values
    (${managerUserId}, 'Workflow Settings Manager', 'workflow-settings-manager@postpilot.test'),
    (${viewerUserId}, 'Workflow Settings Viewer', 'workflow-settings-viewer@postpilot.test')
    on conflict (id) do update set name = excluded.name, email = excluded.email`;
  await sql`insert into organizations (id, name, slug) values
    (${organizationId}, 'Workflow Settings Lab', 'workflow-settings-lab'),
    (${foreignOrganizationId}, 'Workflow Settings Foreign Lab', 'workflow-settings-foreign-lab'),
    (${emptyOrganizationId}, 'Workflow Settings Empty Lab', 'workflow-settings-empty-lab')`;
  await sql`insert into organization_members (organization_id, user_id, role) values
    (${organizationId}, ${managerUserId}, 'member'),
    (${organizationId}, ${viewerUserId}, 'member'),
    (${foreignOrganizationId}, ${managerUserId}, 'member'),
    (${emptyOrganizationId}, ${managerUserId}, 'member')`;
  await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
    (${organizationId}, 'workflow_manager', 'Workflow manager', '["manage_workflow_configuration","manage_workflow_stages","submit_workflow_stages","sign_off_workflow_stages"]'::jsonb),
    (${organizationId}, 'workflow_viewer', 'Workflow viewer', '[]'::jsonb),
    (${foreignOrganizationId}, 'workflow_manager', 'Workflow manager', '["manage_workflow_configuration","manage_workflow_stages"]'::jsonb),
    (${emptyOrganizationId}, 'workflow_manager', 'Workflow manager', '["manage_workflow_configuration","manage_workflow_stages"]'::jsonb)`;
  await sql`insert into people (id, organization_id, user_id, name, email, role) values
    (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Workflow Settings Manager', 'workflow-settings-manager@postpilot.test', 'workflow_manager'),
    (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'Workflow Settings Viewer', 'workflow-settings-viewer@postpilot.test', 'workflow_viewer'),
    (${foreignManagerPersonId}, ${foreignOrganizationId}, ${managerUserId}, 'Workflow Settings Manager', 'workflow-settings-manager@postpilot.test', 'workflow_manager'),
    (${emptyManagerPersonId}, ${emptyOrganizationId}, ${managerUserId}, 'Workflow Settings Manager', 'workflow-settings-manager@postpilot.test', 'workflow_manager')`;
  await sql`insert into post_workflows (id, organization_id, name, description, is_default) values
    (${workflowId}, ${organizationId}, 'Settings lab workflow', 'Workflow configuration coverage.', true),
    (${foreignWorkflowId}, ${foreignOrganizationId}, 'Foreign workflow', null, true)`;
  await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early, requires_qc_pass) values
    (${editorialStageId}, ${organizationId}, ${workflowId}, 'Editorial handoff', 'editorial_handoff', 1, '#506f68', false, false, false),
    (${qcStageId}, ${organizationId}, ${workflowId}, 'Quality control', 'quality_control', 2, '#506f68', false, false, true),
    (${deliveryStageId}, ${organizationId}, ${workflowId}, 'Delivery', 'delivery', 3, '#66819a', true, false, false),
    (${foreignStageId}, ${foreignOrganizationId}, ${foreignWorkflowId}, 'Foreign editorial', 'foreign_editorial', 1, '#725f8f', false, false, false)`;
  await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${editorialRuleId}, ${organizationId}, ${editorialStageId}, 'workflow_manager', 'Workflow manager sign-off', 1, true)`;
  await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Workflow Settings Series', 'WFS', 'Europe/London')`;
  await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
  await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, number, title, status, qc_status) values
    (${editorialEpisodeId}, ${organizationId}, ${seasonId}, ${editorialStageId}, 1, 'Stage history episode', 'editor_cut', 'not_started'),
    (${templateEpisodeId}, ${organizationId}, ${seasonId}, null, 2, 'Template activation episode', 'editor_cut', 'not_started')`;
}

test.describe("Workflow settings", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    await resetFixture();
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId}, ${emptyOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${viewerUserId})`;
    await sql.end();
  });

  test("lets a manager add, persist, and remove ordered stages and sign-off slots", async ({ page }) => {
    await assume(page, managerUserId, organizationId);
    await page.goto("/settings/workflow");

    await page.getByRole("button", { name: "Add stage", exact: true }).click();
    const stageNames = page.getByLabel("Stage name");
    await expect(stageNames).toHaveCount(4);
    await stageNames.nth(3).fill("Archive preparation");
    await page.getByRole("button", { name: "Add sign-off", exact: true }).first().click();
    await page.getByLabel("Sign-off slot 2").fill("Creative approval");
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");

    await page.reload();
    await expect(page.getByLabel("Stage name")).toHaveCount(4);
    await expect(page.getByLabel("Stage name").nth(3)).toHaveValue("Archive preparation");
    await expect(page.getByLabel("Sign-off slot 2")).toHaveValue("Creative approval");
    await expect(page.getByLabel("Mark Delivery as terminal")).toBeChecked();
    await expect(page.getByRole("button", { name: /Delete Quality control/ })).toBeDisabled();

    await page.getByRole("button", { name: "Delete Archive preparation", exact: true }).click();
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");
    await page.reload();
    await expect(page.getByLabel("Stage name")).toHaveCount(3);
  });

  test("keeps the saved workflow unchanged when validation or protected-history deletion fails", async ({ page }) => {
    await assume(page, managerUserId, organizationId);
    await page.goto("/settings/workflow");

    await page.getByLabel("Stage name").first().fill("X");
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).not.toHaveText("Workflow saved. New sign-offs use these roles.");
    await expect(page.getByLabel("Stage name").first()).toHaveValue("X");

    await page.reload();
    await sql`insert into episode_workflow_tracks (organization_id, episode_id, workflow_stage_id, status, started_at) values (${organizationId}, ${editorialEpisodeId}, ${editorialStageId}, 'in_progress', now()) on conflict (episode_id, workflow_stage_id) do nothing`;
    await page.getByRole("button", { name: "Delete Editorial handoff", exact: true }).click();
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("episode workflow history cannot be deleted");
    await page.reload();
    await expect(page.getByLabel("Stage name").first()).toHaveValue("Editorial handoff");

    await page.route(`**/api/workflows/${workflowId}`, (route) => route.abort());
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Could not save the workflow.");
    await page.unroute(`**/api/workflows/${workflowId}`);
  });

  test("reorders workflow stages with the keyboard and persists the new order", async ({ page }) => {
    await assume(page, managerUserId, organizationId);
    await page.goto("/settings/workflow");

    await page.getByRole("button", { name: "Drag to reorder Delivery", exact: true }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByLabel("Stage name").nth(1)).toHaveValue("Delivery");
    await page.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Workflow saved.");

    const savedStages = await sql`select key from workflow_stages where organization_id = ${organizationId} order by position`;
    expect(savedStages.map((stage) => stage.key)).toEqual(["editorial_handoff", "delivery", "quality_control"]);
  });

  test("rejects malformed and cross-tenant workflow payloads without changing the active tenant workflow", async ({ page }) => {
    await assume(page, managerUserId, organizationId);
    const original = await sql`select key, position from workflow_stages where organization_id = ${organizationId} order by position`;

    const duplicateKey = workflowPayload({ stages: [
      { ...baseStages()[0], key: "duplicate" },
      { ...baseStages()[1], key: "duplicate" },
      baseStages()[2],
    ] });
    expect((await page.request.patch(`/api/workflows/${workflowId}`, { data: duplicateKey })).status()).toBe(400);

    expect((await page.request.patch(`/api/workflows/${workflowId}`, { data: workflowPayload({ stages: [], rules: [] }) })).status()).toBe(400);

    expect((await page.request.patch(`/api/workflows/${workflowId}`, { data: workflowPayload({ rules: [{ ...baseRules()[0], workflowStageId: foreignStageId }] }) })).status()).toBe(400);

    const foreignStagePayload = workflowPayload({ stages: [...baseStages(), { id: foreignStageId, name: "Foreign editorial", key: "foreign_editorial", position: 4, color: "#725f8f", isTerminal: false, canStartEarly: false, requiresQcPass: false, deliveryGate: "none" }] });
    expect((await page.request.patch(`/api/workflows/${workflowId}`, { data: foreignStagePayload })).status()).toBe(400);

    expect((await page.request.patch(`/api/workflows/${foreignWorkflowId}`, { data: workflowPayload() })).status()).toBe(404);
    expect(await sql`select key, position from workflow_stages where organization_id = ${organizationId} order by position`).toEqual(original);
  });

  test("does not delete a non-QC stage with historical approvals or workflow tracks", async ({ page }) => {
    await assume(page, managerUserId, organizationId);
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${deliveryRuleId}, ${organizationId}, ${deliveryStageId}, 'workflow_manager', 'Delivery sign-off', 1, true)`;
    await sql`insert into episode_workflow_tracks (organization_id, episode_id, workflow_stage_id, status, started_at, completed_at) values (${organizationId}, ${templateEpisodeId}, ${deliveryStageId}, 'approved', now(), now())`;
    await sql`insert into episode_workflow_approvals (organization_id, episode_id, workflow_stage_id, approval_rule_id, approver_role, status, responded_at) values (${organizationId}, ${templateEpisodeId}, ${deliveryStageId}, ${deliveryRuleId}, 'workflow_manager', 'approved', now())`;

    const response = await page.request.patch(`/api/workflows/${workflowId}`, {
      data: workflowPayload({ stages: baseStages().slice(0, 2), rules: [baseRules()[0]] }),
    });

    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "A stage with episode workflow history cannot be deleted." });
    expect(await sql`select id from workflow_stages where id = ${deliveryStageId}`).toHaveLength(1);
  });

  test("denies users without workflow permission and renders the no-workflow state", async ({ page }) => {
    await assume(page, viewerUserId, organizationId);
    const denied = await page.request.patch(`/api/workflows/${workflowId}`, { data: workflowPayload() });
    expect(denied.status()).toBe(403);
    await page.goto("/settings/workflow");
    await expect(page).toHaveURL(/\/$/);

    await assume(page, managerUserId, emptyOrganizationId);
    await page.goto("/settings/workflow");
    await expect(page.getByRole("heading", { name: "No workflow configured" })).toBeVisible();
  });

  test("keeps workflow settings usable on a mobile-width viewport", async ({ page }) => {
    await assume(page, managerUserId, organizationId);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/workflow");
    await expect(page.getByRole("button", { name: "Add stage", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save workflow", exact: true })).toBeVisible();
    const overflowingElements = await page.locator("body *").evaluateAll((elements) => elements
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((element) => ({ className: element.className, right: Math.round(element.getBoundingClientRect().right), text: element.textContent?.trim().slice(0, 60) })));
    expect(overflowingElements).toEqual([]);
  });

});
