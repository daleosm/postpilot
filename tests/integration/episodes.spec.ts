import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for episode integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "96000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "96000000-0000-4000-8000-000000000002";
const managerUserId = "user_episode_lab_manager";
const managerPersonId = "96000000-0000-4000-8000-000000000003";
const editorOneId = "96000000-0000-4000-8000-000000000004";
const editorTwoId = "96000000-0000-4000-8000-000000000005";
const coloristId = "96000000-0000-4000-8000-000000000006";
const workflowId = "96000000-0000-4000-8000-000000000007";
const workflowStageId = "96000000-0000-4000-8000-000000000008";
const showId = "96000000-0000-4000-8000-000000000009";
const seasonId = "96000000-0000-4000-8000-000000000010";
const emptySeasonId = "96000000-0000-4000-8000-000000000011";
const priorEpisodeId = "96000000-0000-4000-8000-000000000012";
const foreignWorkflowId = "96000000-0000-4000-8000-000000000013";
const foreignStageId = "96000000-0000-4000-8000-000000000014";
const foreignShowId = "96000000-0000-4000-8000-000000000015";
const foreignSeasonId = "96000000-0000-4000-8000-000000000016";
const foreignEpisodeId = "96000000-0000-4000-8000-000000000017";
const foreignPersonId = "96000000-0000-4000-8000-000000000018";
const approvalRuleId = "96000000-0000-4000-8000-000000000019";

let createdEpisodeId = "";

function episodePayload(overrides: Record<string, unknown> = {}) {
  return {
    seasonId,
    workflowStageId,
    assignedProducerId: managerPersonId,
    editorId: editorOneId,
    coloristId,
    soundMixerId: null,
    number: 2,
    productionCode: "EPL102",
    title: "New episode workflow",
    synopsis: "Episode integration fixture.",
    status: "assembly",
    qcStatus: "not_started",
    airDate: "2035-03-11T12:00:00.000Z",
    lockedCutDate: "2035-03-04T12:00:00.000Z",
    deliveryDeadline: "2035-03-20T17:00:00.000Z",
    team: [editorOneId, coloristId],
    ...overrides,
  };
}

async function useManagerSession(page: Page) {
  const user = await page.request.post("/api/debug/user", { data: { userId: managerUserId } });
  expect(user.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/episodes" } });
  expect(tenant.status()).toBe(200);
}

test.describe("Episode lifecycle integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`
      insert into users (id, name, email) values
        (${managerUserId}, 'Episode Lab Manager', 'episode-lab-manager@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`insert into organizations (id, name, slug) values (${organizationId}, 'Episode Lifecycle Lab', 'episode-lifecycle-lab'), (${foreignOrganizationId}, 'Foreign Episode Lab', 'foreign-episode-lab')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, ${managerUserId}, 'admin')`;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role) values
        (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Episode Lab Manager', 'episode-lab-manager@postpilot.test', 'producer'),
        (${editorOneId}, ${organizationId}, null, 'First Editor', 'first-editor@postpilot.test', 'editor'),
        (${editorTwoId}, ${organizationId}, null, 'Second Editor', 'second-editor@postpilot.test', 'editor'),
        (${coloristId}, ${organizationId}, null, 'Finishing Colourist', 'finishing-colourist@postpilot.test', 'colorist'),
        (${foreignPersonId}, ${foreignOrganizationId}, null, 'Foreign Editor', 'foreign-editor@postpilot.test', 'editor')
    `;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'Episode lifecycle', true), (${foreignWorkflowId}, ${foreignOrganizationId}, 'Foreign workflow', true)`;
    await sql`
      insert into workflow_stages (id, organization_id, workflow_id, name, key, position, color, is_terminal, can_start_early) values
        (${workflowStageId}, ${organizationId}, ${workflowId}, 'Editorial preparation', 'editorial_prep', 1, '#506f68', false, false),
        (${foreignStageId}, ${foreignOrganizationId}, ${foreignWorkflowId}, 'Foreign stage', 'foreign_stage', 1, '#506f68', false, false)
    `;
    await sql`insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required) values (${approvalRuleId}, ${organizationId}, ${workflowStageId}, 'editor', 'Editorial sign-off', 1, true)`;
    await sql`insert into workflow_stage_work_order_templates (organization_id, workflow_stage_id, title, priority, is_blocking, position) values (${organizationId}, ${workflowStageId}, 'Prepare editorial turnover', 'normal', true, 1)`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values (${showId}, ${organizationId}, 'Episode Lifecycle Series', 'EPL', 'Europe/London'), (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Episode Series', 'FEP', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number, title) values (${seasonId}, ${organizationId}, ${showId}, 1, 'Episode Lifecycle · Season 1'), (${emptySeasonId}, ${organizationId}, ${showId}, 2, 'Episode Lifecycle · Season 2'), (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1, 'Foreign Episode · Season 1')`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, editor_id, number, production_code, title, status, qc_status) values (${priorEpisodeId}, ${organizationId}, ${seasonId}, ${workflowStageId}, ${editorOneId}, 1, 'EPL101', 'Prior episode', 'assembly', 'not_started'), (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, ${foreignStageId}, ${foreignPersonId}, 1, 'FEP101', 'Foreign episode', 'assembly', 'not_started')`;
    await sql`insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead) values (${organizationId}, ${priorEpisodeId}, ${editorOneId}, true)`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id = ${managerUserId}`;
    await sql.end();
  });

  test("creates a complete episode with its selected team and stage work orders", async ({ page }) => {
    await useManagerSession(page);
    const response = await page.request.post("/api/episodes", { data: episodePayload() });
    expect(response.status()).toBe(201);
    createdEpisodeId = (await response.json()).id as string;

    const [episode] = await sql`select number, production_code, title, workflow_stage_id, editor_id, colorist_id, status, air_date, locked_cut_date from episodes where id = ${createdEpisodeId}`;
    expect(episode).toMatchObject({ number: 2, production_code: "EPL102", title: "New episode workflow", workflow_stage_id: workflowStageId, editor_id: editorOneId, colorist_id: coloristId, status: "assembly" });
    expect(new Date(episode.air_date).toISOString().slice(0, 10)).toBe("2035-03-11");
    expect(new Date(episode.locked_cut_date).toISOString().slice(0, 10)).toBe("2035-03-04");
    const team = await sql`select person_id from episode_team_assignments where organization_id = ${organizationId} and episode_id = ${createdEpisodeId} order by person_id`;
    expect(team).toEqual(expect.arrayContaining([{ person_id: editorOneId }, { person_id: coloristId }]));
    const [workOrder] = await sql`select title, workflow_stage_id, is_blocking from post_work_orders where organization_id = ${organizationId} and episode_id = ${createdEpisodeId}`;
    expect(workOrder).toMatchObject({ title: "Prepare editorial turnover", workflow_stage_id: workflowStageId, is_blocking: true });
  });

  test("rejects duplicate numbers and foreign episode references", async ({ page }) => {
    await useManagerSession(page);
    const duplicate = await page.request.post("/api/episodes", { data: episodePayload() });
    expect(duplicate.status()).toBe(409);

    const foreignSeason = await page.request.post("/api/episodes", { data: episodePayload({ seasonId: foreignSeasonId, number: 3 }) });
    expect(foreignSeason.status()).toBe(404);

    const foreignReferences = await page.request.post("/api/episodes", { data: episodePayload({ number: 3, workflowStageId: foreignStageId, editorId: foreignPersonId }) });
    expect(foreignReferences.status()).toBe(404);
  });

  test("edits episode details only in the active post house", async ({ page }) => {
    await useManagerSession(page);
    const update = await page.request.patch(`/api/episodes/${createdEpisodeId}/details`, { data: { title: "Renamed episode", productionCode: "EPL102A", status: "review", airDate: "2035-03-12", lockedCutDate: "2035-03-05", deliveryDeadline: "2035-03-21T17:30:00.000Z" } });
    expect(update.status()).toBe(200);
    const [episode] = await sql`select title, production_code, status, air_date, locked_cut_date, delivery_deadline from episodes where id = ${createdEpisodeId}`;
    expect(episode).toMatchObject({ title: "Renamed episode", production_code: "EPL102A", status: "review" });
    expect(new Date(episode.air_date).toISOString().slice(0, 10)).toBe("2035-03-12");
    expect(new Date(episode.locked_cut_date).toISOString().slice(0, 10)).toBe("2035-03-05");
    expect(new Date(episode.delivery_deadline).toISOString()).toBe("2035-03-21T17:30:00.000Z");

    const invalid = await page.request.patch(`/api/episodes/${createdEpisodeId}/details`, { data: { title: "", productionCode: null, status: "review", airDate: null, lockedCutDate: null, deliveryDeadline: null } });
    expect(invalid.status()).toBe(400);

    const foreign = await page.request.patch(`/api/episodes/${foreignEpisodeId}/details`, { data: { title: "Should not change", productionCode: null, status: "review", airDate: null, lockedCutDate: null, deliveryDeadline: null } });
    expect(foreign.status()).toBe(404);
    const [foreignEpisode] = await sql`select title from episodes where id = ${foreignEpisodeId}`;
    expect(foreignEpisode.title).toBe("Foreign episode");
  });

  test("manages the episode team without cross-tenant people or duplicate assignments", async ({ page }) => {
    await useManagerSession(page);
    const add = await page.request.post(`/api/episodes/${createdEpisodeId}/team`, { data: { personId: editorTwoId } });
    expect(add.status()).toBe(201);
    const duplicate = await page.request.post(`/api/episodes/${createdEpisodeId}/team`, { data: { personId: editorTwoId } });
    expect(duplicate.status()).toBe(200);
    const foreignPerson = await page.request.post(`/api/episodes/${createdEpisodeId}/team`, { data: { personId: foreignPersonId } });
    expect(foreignPerson.status()).toBe(404);

    const teamResponse = await page.request.get(`/api/episodes/${createdEpisodeId}/team`);
    expect(teamResponse.status()).toBe(200);
    const team = await teamResponse.json() as { assignments: Array<{ id: string; personId: string; isLead: boolean }> };
    const editorTwoAssignment = team.assignments.find((assignment) => assignment.personId === editorTwoId);
    expect(editorTwoAssignment).toBeTruthy();
    if (!editorTwoAssignment) throw new Error("Expected the second editor to be assigned.");
    const signer = await page.request.patch(`/api/episodes/${createdEpisodeId}/team`, { data: { assignmentId: editorTwoAssignment.id, isSigner: true } });
    expect(signer.status()).toBe(200);
    const editors = await sql`select assignment.person_id, assignment.is_lead from episode_team_assignments assignment inner join people person on person.id = assignment.person_id and person.organization_id = assignment.organization_id where assignment.organization_id = ${organizationId} and assignment.episode_id = ${createdEpisodeId} and person.role = 'editor' order by assignment.person_id`;
    expect(editors).toEqual(expect.arrayContaining([{ person_id: editorOneId, is_lead: false }, { person_id: editorTwoId, is_lead: true }]));

    await sql`insert into episode_workflow_approvals (organization_id, episode_id, workflow_stage_id, approval_rule_id, approver_role, required_person_id, status) values (${organizationId}, ${createdEpisodeId}, ${workflowStageId}, ${approvalRuleId}, 'editor', ${editorTwoId}, 'pending')`;
    const remove = await page.request.delete(`/api/episodes/${createdEpisodeId}/team?assignmentId=${editorTwoAssignment.id}`);
    expect(remove.status()).toBe(409);
    await expect(remove.json()).resolves.toMatchObject({ error: expect.stringContaining("replacement workflow signer") });
    await sql`update episode_workflow_approvals set status = 'approved' where organization_id = ${organizationId} and episode_id = ${createdEpisodeId} and approval_rule_id = ${approvalRuleId}`;
    const removeAfterSignOff = await page.request.delete(`/api/episodes/${createdEpisodeId}/team?assignmentId=${editorTwoAssignment.id}`);
    expect(removeAfterSignOff.status()).toBe(200);
    const [removed] = await sql`select id from episode_team_assignments where id = ${editorTwoAssignment.id}`;
    expect(removed).toBeUndefined();
  });

  test("copies the last episode team only inside the active tenant", async ({ page }) => {
    await useManagerSession(page);
    const previous = await page.request.get(`/api/seasons/${seasonId}/last-episode-team`);
    expect(previous.status()).toBe(200);
    await expect(previous.json()).resolves.toMatchObject({ episode: { id: createdEpisodeId }, team: [{ personId: editorOneId }, { personId: coloristId }] });

    const empty = await page.request.get(`/api/seasons/${emptySeasonId}/last-episode-team`);
    expect(empty.status()).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ episode: null, team: [] });

    const foreign = await page.request.get(`/api/seasons/${foreignSeasonId}/last-episode-team`);
    expect(foreign.status()).toBe(404);
  });

  test("does not expose a foreign episode team through nested routes", async ({ page }) => {
    await useManagerSession(page);
    const response = await page.request.get(`/api/episodes/${foreignEpisodeId}/team`);
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Episode not found." });
  });
});
