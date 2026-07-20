import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for workflow progression tests.");

const sql = postgres(databaseUrl, { prepare: false });
const organizationId = "97100000-0000-4000-8000-000000000001";
const workflowId = "97100000-0000-4000-8000-000000000002";
const showId = "97100000-0000-4000-8000-000000000003";
const seasonId = "97100000-0000-4000-8000-000000000004";
const episodeId = "97100000-0000-4000-8000-000000000005";
const mayaPersonId = "97100000-0000-4000-8000-000000000006";
const editorialStageId = "97100000-0000-4000-8000-000000000007";
const lockStageId = "97100000-0000-4000-8000-000000000008";
const onlineStageId = "97100000-0000-4000-8000-000000000009";
const editorialRuleId = "97100000-0000-4000-8000-000000000010";
const producerPersonId = "97100000-0000-4000-8000-000000000013";
const artistPersonId = "97100000-0000-4000-8000-000000000014";
const secondRuleId = "97100000-0000-4000-8000-000000000015";
const foreignOrganizationId = "97100000-0000-4000-8000-000000000017";
const foreignWorkflowId = "97100000-0000-4000-8000-000000000018";
const foreignShowId = "97100000-0000-4000-8000-000000000019";
const foreignSeasonId = "97100000-0000-4000-8000-000000000020";
const foreignEpisodeId = "97100000-0000-4000-8000-000000000021";
const foreignStageId = "97100000-0000-4000-8000-000000000022";
const foreignPersonId = "97100000-0000-4000-8000-000000000023";
const producerUserId = "workflow-progression-producer";
const artistUserId = "workflow-progression-artist";
const foreignUserId = "workflow-progression-foreign";
const guestUserId = "workflow-progression-guest";
const guestPersonId = "97100000-0000-4000-8000-000000000024";

async function assume(page: Page, userId: string, activeOrganizationId = organizationId, episode = episodeId) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId: activeOrganizationId, pathname: `/episodes/${episode}` } })).status()).toBe(200);
}

async function resetEpisode() {
  await sql`delete from workflow_stage_approval_rules where id = ${secondRuleId}`;
  await sql`delete from episode_workflow_exceptions where organization_id = ${organizationId}`;
  await sql`delete from episode_workflow_approvals where organization_id = ${organizationId}`;
  await sql`delete from activity_log where organization_id = ${organizationId}`;
  await sql`update episodes set workflow_stage_id = ${editorialStageId}, workflow_status = 'not_started', status = 'development' where id = ${episodeId}`;
}

test.describe("Current-stage workflow progression", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${producerUserId}, 'Workflow Producer', 'workflow-progression-producer@test.local'),
      (${artistUserId}, 'Workflow Artist', 'workflow-progression-artist@test.local'),
      (${foreignUserId}, 'Foreign Workflow Manager', 'workflow-progression-foreign@test.local'),
      (${guestUserId}, 'Workflow Guest', 'workflow-progression-guest@test.local')
      on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Workflow Progression Lab', 'workflow-progression-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, 'user_maya', 'member'), (${organizationId}, ${producerUserId}, 'member'), (${organizationId}, ${artistUserId}, 'member'), (${organizationId}, ${guestUserId}, 'client')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'post_supervisor', 'Workflow manager', '["manage_shows","manage_workflow_stages","submit_workflow_stages","sign_off_workflow_stages","authorize_early_starts"]'::jsonb),
      (${organizationId}, 'producer', 'Workflow producer', '["sign_off_workflow_stages"]'::jsonb),
      (${organizationId}, 'artist', 'Assigned artist', '["update_assigned_workflow_work","sign_off_workflow_stages"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${mayaPersonId}, ${organizationId}, 'user_maya', 'Maya Ortiz', 'maya@postpilot.debug', 'post_supervisor'),
      (${producerPersonId}, ${organizationId}, ${producerUserId}, 'Workflow Producer', 'workflow-progression-producer@test.local', 'producer'),
      (${artistPersonId}, ${organizationId}, ${artistUserId}, 'Workflow Artist', 'workflow-progression-artist@test.local', 'artist'),
      (${guestPersonId}, ${organizationId}, ${guestUserId}, 'Workflow Guest', 'workflow-progression-guest@test.local', 'client')`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'Progression workflow', true)`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early) values
      (${editorialStageId}, ${organizationId}, ${workflowId}, 'Editorial', 'editorial', 1, '#506f68', false, false),
      (${lockStageId}, ${organizationId}, ${workflowId}, 'Picture lock', 'picture_lock', 2, '#a66d46', false, false),
      (${onlineStageId}, ${organizationId}, ${workflowId}, 'Online', 'online', 3, '#66819a', true, true)`;
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${editorialRuleId}, ${organizationId}, ${editorialStageId}, 'post_supervisor', 'Post Supervisor sign-off', 1, true)`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Workflow Progression', 'WPR', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, workflow_status, number, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, ${editorialStageId}, 'not_started', 1, 'A current-stage episode', 'development', 'not_started')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead) values
      (${organizationId}, ${episodeId}, ${mayaPersonId}, true), (${organizationId}, ${episodeId}, ${producerPersonId}, true), (${organizationId}, ${episodeId}, ${artistPersonId}, false), (${organizationId}, ${episodeId}, ${guestPersonId}, false)`;
    await sql`insert into episode_workflow_signers (organization_id, episode_id, workflow_stage_approval_rule_id, person_id) values (${organizationId}, ${episodeId}, ${editorialRuleId}, ${mayaPersonId})`;
    await sql`insert into organizations (id, name, slug) values (${foreignOrganizationId}, 'Foreign workflow lab', 'foreign-workflow-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${foreignOrganizationId}, ${foreignUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values (${foreignOrganizationId}, 'post_supervisor', 'Workflow manager', '["manage_workflow_stages","submit_workflow_stages","sign_off_workflow_stages"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values (${foreignPersonId}, ${foreignOrganizationId}, ${foreignUserId}, 'Foreign Workflow Manager', 'workflow-progression-foreign@test.local', 'post_supervisor')`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${foreignWorkflowId}, ${foreignOrganizationId}, 'Foreign workflow', true)`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal) values (${foreignStageId}, ${foreignOrganizationId}, ${foreignWorkflowId}, 'Foreign editorial', 'foreign_editorial', 1, '#506f68', true)`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${foreignShowId}, ${foreignOrganizationId}, 'Foreign workflow', 'FWR', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, workflow_status, number, title, status, qc_status) values (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, ${foreignStageId}, 'not_started', 1, 'Foreign episode', 'development', 'not_started')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead) values (${foreignOrganizationId}, ${foreignEpisodeId}, ${foreignPersonId}, true)`;
  });

  test.beforeEach(resetEpisode);

  test("starts, blocks, resumes, submits, and automatically advances after sign-off", async ({ page }) => {
    await assume(page, "user_maya");
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "block", reason: "Waiting for revised script" } })).status()).toBe(200);
    expect(await sql`select workflow_status from episodes where id = ${episodeId}`).toEqual([{ workflow_status: "blocked" }]);
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "resume", reason: "Revised script received" } })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "submit" } })).status()).toBe(200);
    const signed = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off", approvalRuleId: editorialRuleId } });
    expect(signed.status()).toBe(200);
    await expect(signed.json()).resolves.toMatchObject({ stageComplete: true, nextStageId: lockStageId });
    expect(await sql`select workflow_stage_id, workflow_status from episodes where id = ${episodeId}`).toEqual([{ workflow_stage_id: lockStageId, workflow_status: "not_started" }]);
  });

  test("submitting a stage without required sign-off advances it automatically", async ({ page }) => {
    await assume(page, "user_maya");
    await sql`update episodes set workflow_stage_id = ${lockStageId}, workflow_status = 'not_started' where id = ${episodeId}`;
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: lockStageId, action: "start" } })).status()).toBe(200);
    const submit = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: lockStageId, action: "submit" } });
    expect(submit.status()).toBe(200);
    await expect(submit.json()).resolves.toMatchObject({ stageComplete: true, nextStageId: onlineStageId });
    expect(await sql`select workflow_stage_id, workflow_status from episodes where id = ${episodeId}`).toEqual([{ workflow_stage_id: onlineStageId, workflow_status: "not_started" }]);
  });

  test("records an authorised early start without changing the one current stage", async ({ page }) => {
    await assume(page, "user_maya");
    const denied = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: lockStageId, action: "start_early", reason: "Not configured" } });
    expect(denied.status()).toBe(409);
    const early = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: onlineStageId, action: "start_early", reason: "Network test required" } });
    expect(early.status()).toBe(200);
    expect(await sql`select workflow_stage_id, workflow_status from episodes where id = ${episodeId}`).toEqual([{ workflow_stage_id: editorialStageId, workflow_status: "not_started" }]);
    expect(await sql`select workflow_stage_id, reason from episode_workflow_exceptions where episode_id = ${episodeId}`).toEqual([{ workflow_stage_id: onlineStageId, reason: "Network test required" }]);
  });

  test("requires the relevant capability for early starts", async ({ page }) => {
    await assume(page, artistUserId);
    const response = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: onlineStageId, action: "start_early", reason: "Artist cannot authorise" } });
    expect(response.status()).toBe(403);
  });

  test("retains the person's tenant policy when membership access changes", async ({ page }) => {
    await sql`update organization_members set role = 'admin' where organization_id = ${organizationId} and user_id = ${artistUserId}`;
    try {
      await assume(page, artistUserId);
      expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } })).status()).toBe(200);
      const response = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "submit" } });
      expect(response.status()).toBe(200);
    } finally {
      await sql`update organization_members set role = 'member' where organization_id = ${organizationId} and user_id = ${artistUserId}`;
    }
  });

  test("requires the named episode signer even when another person has sign-off capability", async ({ page }) => {
    await assume(page, "user_maya");
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "submit" } })).status()).toBe(200);
    await assume(page, artistUserId);
    const response = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off", approvalRuleId: editorialRuleId } });
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "This sign-off is assigned to another episode-team member." });
  });

  test("waits for every configured required signer before advancing", async ({ page }) => {
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${secondRuleId}, ${organizationId}, ${editorialStageId}, 'producer', 'Producer sign-off', 2, true)`;
    await sql`insert into episode_workflow_signers (organization_id, episode_id, workflow_stage_approval_rule_id, person_id) values (${organizationId}, ${episodeId}, ${secondRuleId}, ${producerPersonId})`;
    await assume(page, "user_maya");
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "submit" } })).status()).toBe(200);
    expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off", approvalRuleId: editorialRuleId } })).status()).toBe(200);
    expect(await sql`select workflow_stage_id, workflow_status from episodes where id = ${episodeId}`).toEqual([{ workflow_stage_id: editorialStageId, workflow_status: "awaiting_sign_off" }]);
    await assume(page, producerUserId);
    const signed = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off", approvalRuleId: secondRuleId } });
    expect(signed.status()).toBe(200);
    expect(await sql`select workflow_stage_id, workflow_status from episodes where id = ${episodeId}`).toEqual([{ workflow_stage_id: lockStageId, workflow_status: "not_started" }]);
  });

  test("keeps Guest restricted while allowing an explicitly assigned guest signer", async ({ page }) => {
    await sql`update episode_workflow_signers set person_id = ${guestPersonId} where organization_id = ${organizationId} and episode_id = ${episodeId} and workflow_stage_approval_rule_id = ${editorialRuleId}`;
    try {
      await assume(page, guestUserId);
      const deniedStart = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } });
      expect(deniedStart.status()).toBe(403);
      await assume(page, "user_maya");
      expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } })).status()).toBe(200);
      expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "submit" } })).status()).toBe(200);
      await assume(page, guestUserId);
      expect((await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "sign_off", approvalRuleId: editorialRuleId } })).status()).toBe(200);
    } finally {
      await sql`update episode_workflow_signers set person_id = ${mayaPersonId} where organization_id = ${organizationId} and episode_id = ${episodeId} and workflow_stage_approval_rule_id = ${editorialRuleId}`;
    }
  });

  test("rejects cross-tenant workflow requests", async ({ page }) => {
    await assume(page, foreignUserId, foreignOrganizationId, foreignEpisodeId);
    const response = await page.request.post(`/api/episodes/${episodeId}`, { data: { workflowStageId: editorialStageId, action: "start" } });
    expect(response.status()).toBe(404);
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${producerUserId}, ${artistUserId}, ${foreignUserId}, ${guestUserId})`;
    await sql.end();
  });
});
