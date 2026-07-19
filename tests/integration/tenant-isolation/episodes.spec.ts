import { expect, test } from "@playwright/test";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const LANTERN_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000004";
const COPPERLINE_EPISODE_ID = "27500000-0000-4000-8000-000000000001";
const LANTERN_EPISODE_ID = "27400000-0000-4000-8000-000000000001";
const COPPERLINE_ASSEMBLY_STAGE_ID = "22500000-0000-4000-8000-000000000001";

test.describe("Episodes tenant isolation", () => {
  test("does not render a Lantern episode when Copperline is the active tenant", async ({ page }) => {
    await page.goto(`/episodes/${LANTERN_EPISODE_ID}`);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("Smoke Test")).not.toBeVisible();
  });

  test("rejects a cross-tenant episode workflow update", async ({ page }) => {
    await page.goto("/episodes");

    const response = await page.request.post(`/api/episodes/${LANTERN_EPISODE_ID}`, {
      data: { workflowStageId: COPPERLINE_ASSEMBLY_STAGE_ID, action: "start" },
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Episode not found." });

    await page.goto(`/episodes/${LANTERN_EPISODE_ID}`);
    await expect(page.getByText("Smoke Test")).not.toBeVisible();
  });

  test("strips a Copperline episode route when switching to Lantern", async ({ page }) => {
    await page.goto("/episodes");

    const response = await page.request.post("/api/organizations/active", {
      data: {
        organizationId: LANTERN_ORGANIZATION_ID,
        pathname: `/episodes/${COPPERLINE_EPISODE_ID}`,
      },
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ redirectTo: "/" });

    await page.request.post("/api/organizations/active", {
      data: { organizationId: COPPERLINE_ORGANIZATION_ID, pathname: "/episodes" },
    });
  });
});
