import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for guest episode access tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "94000000-0000-4000-8000-000000000001";
const guestUserId = "user_guest_episode_lab";
const guestPersonId = "94000000-0000-4000-8000-000000000002";
const showId = "94000000-0000-4000-8000-000000000003";
const seasonId = "94000000-0000-4000-8000-000000000004";
const assignedEpisodeId = "94000000-0000-4000-8000-000000000005";
const privateEpisodeId = "94000000-0000-4000-8000-000000000006";
const workflowId = "94000000-0000-4000-8000-000000000007";
const workflowStageId = "94000000-0000-4000-8000-000000000008";
const approvalRuleId = "94000000-0000-4000-8000-000000000009";

async function useGuestSession(page: Page) {
  const user = await page.request.post("/api/debug/user", { data: { userId: guestUserId } });
  expect(user.status()).toBe(200);
  const tenant = await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/episodes" } });
  expect(tenant.status()).toBe(200);
}

test.describe("Guest episode access", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`
      insert into users (id, name, email)
      values (${guestUserId}, 'Episode Guest', 'episode-guest@postpilot.test')
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'Guest Episode Lab', 'guest-episode-lab')
    `;
    await sql`
      insert into organization_members (organization_id, user_id, role)
      values (${organizationId}, ${guestUserId}, 'client')
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role)
      values (${guestPersonId}, ${organizationId}, ${guestUserId}, 'Episode Guest', 'episode-guest@postpilot.test', 'client')
    `;
    await sql`
      insert into post_workflows (id, organization_id, name, is_default)
      values (${workflowId}, ${organizationId}, 'Guest access workflow', true)
    `;
    await sql`
      insert into workflow_stages (id, organization_id, workflow_id, name, key, position)
      values (${workflowStageId}, ${organizationId}, ${workflowId}, 'External review', 'external_review', 1)
    `;
    await sql`
      insert into workflow_stage_approval_rules (id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required)
      values (${approvalRuleId}, ${organizationId}, ${workflowStageId}, 'client', 'Client sign-off', 1, true)
    `;
    await sql`
      insert into shows (id, organization_id, title, code, time_zone)
      values (${showId}, ${organizationId}, 'Guest Access Series', 'GAS', 'Europe/London')
    `;
    await sql`
      insert into seasons (id, organization_id, show_id, number, title)
      values (${seasonId}, ${organizationId}, ${showId}, 1, 'Guest Access Series · Season 1')
    `;
    await sql`
      insert into episodes (id, organization_id, season_id, number, production_code, title, status, qc_status, workflow_stage_id)
      values
        (${assignedEpisodeId}, ${organizationId}, ${seasonId}, 1, 'GAS101', 'Guest-accessible episode', 'assembly', 'not_started', ${workflowStageId}),
        (${privateEpisodeId}, ${organizationId}, ${seasonId}, 2, 'GAS102', 'Private episode', 'assembly', 'not_started', null)
    `;
    await sql`
      insert into episode_team_assignments (organization_id, episode_id, person_id, is_lead)
      values (${organizationId}, ${assignedEpisodeId}, ${guestPersonId}, true)
    `;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from users where id = ${guestUserId}`;
    await sql.end();
  });

  test("lists only episodes that include the guest in their episode team", async ({ page }) => {
    await useGuestSession(page);
    await page.goto("/episodes");

    await expect(page.getByText("Guest-accessible episode", { exact: true })).toBeVisible();
    await expect(page.getByText("Private episode", { exact: true })).toHaveCount(0);
  });

  test("does not expose another episode through the dashboard or show workspace", async ({ page }) => {
    await useGuestSession(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/episodes$/);
    await expect(page.getByText("Private episode", { exact: true })).toHaveCount(0);

    await page.goto(`/shows/${showId}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("Private episode", { exact: true })).toHaveCount(0);
  });

  test("denies a direct route to an episode the guest is not part of", async ({ page }) => {
    await useGuestSession(page);
    await page.goto(`/episodes/${privateEpisodeId}`);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("Private episode", { exact: true })).toHaveCount(0);
  });

  test("does not let a guest change an episode they cannot see", async ({ page }) => {
    await useGuestSession(page);
    const response = await page.request.patch(`/api/episodes/${privateEpisodeId}`, {
      data: { workflowStageId: "not-a-stage" },
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Episode not found." });
  });

  test("allows a direct route to an episode the guest is assigned to", async ({ page }) => {
    await useGuestSession(page);
    await page.goto(`/episodes/${assignedEpisodeId}`);

    await expect(page.getByRole("heading", { name: "Guest-accessible episode" })).toBeVisible();
  });

  test("does not let an assigned guest use episode-management endpoints", async ({ page }) => {
    await useGuestSession(page);

    const workflow = await page.request.patch(`/api/episodes/${assignedEpisodeId}`, { data: { workflowStageId: "00000000-0000-4000-8000-000000000001" } });
    expect(workflow.status()).toBe(403);
    const details = await page.request.patch(`/api/episodes/${assignedEpisodeId}/details`, { data: { title: "Should not change", productionCode: null, status: "assembly", airDate: null, lockedCutDate: null, deliveryDeadline: null } });
    expect(details.status()).toBe(403);
    const team = await page.request.post(`/api/episodes/${assignedEpisodeId}/team`, { data: { personId: guestPersonId } });
    expect(team.status()).toBe(403);
    const create = await page.request.post("/api/episodes", { data: {} });
    expect(create.status()).toBe(403);
  });

  test("lets an assigned Guest sign off a Guest-configured workflow gate", async ({ page }) => {
    await useGuestSession(page);
    const response = await page.request.post(`/api/episodes/${assignedEpisodeId}`, {
      data: { workflowStageId, approvalRuleId, action: "sign_off" },
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: "approved", stageComplete: true });
  });
});
