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
      values (${organizationId}, ${guestUserId}, 'guest')
    `;
    // The guest has a broad custom policy: membership must still constrain it
    // to episodes where the person is explicitly on the episode team.
    await sql`
      insert into organization_role_policies (organization_id, role, label, permissions)
      values (${organizationId}, 'guest_collaborator', 'Guest collaborator', '["manage_shows", "view_assigned"]'::jsonb)
    `;
    await sql`
      insert into people (id, organization_id, user_id, name, email, role)
      values (${guestPersonId}, ${organizationId}, ${guestUserId}, 'Episode Guest', 'episode-guest@postpilot.test', 'guest_collaborator')
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
      insert into episodes (id, organization_id, season_id, number, production_code, title, status, qc_status)
      values
        (${assignedEpisodeId}, ${organizationId}, ${seasonId}, 1, 'GAS101', 'Guest-accessible episode', 'assembly', 'not_started'),
        (${privateEpisodeId}, ${organizationId}, ${seasonId}, 2, 'GAS102', 'Private episode', 'assembly', 'not_started')
    `;
    await sql`
      insert into episode_team_assignments (organization_id, episode_id, person_id, responsibility, is_lead)
      values (${organizationId}, ${assignedEpisodeId}, ${guestPersonId}, 'guest_collaborator', false)
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
});
