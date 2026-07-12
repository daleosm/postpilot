import { expect, test } from "@playwright/test";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const LANTERN_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000004";
const COPPERLINE_CUT_ID = "2b500000-0000-4000-8000-000000000001";
const LANTERN_CUT_ID = "2b400000-0000-4000-8000-000000000001";
const LANTERN_EPISODE_ID = "27400000-0000-4000-8000-000000000002";

test.describe("Review tenant isolation", () => {
  test("does not render a Lantern review cut when Copperline is active", async ({ page }) => {
    await page.goto(`/review/${LANTERN_CUT_ID}`);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("CA102 producer review")).not.toBeVisible();
  });

  test("rejects registration of a cut against a Lantern episode", async ({ page }) => {
    await page.goto("/review");

    const response = await page.request.post("/api/review-cuts", {
      data: {
        episodeId: LANTERN_EPISODE_ID,
        title: "Cross-tenant cut attempt",
        version: 1,
        runtimeSeconds: 2400,
        status: "in_review",
        approvalStatus: "pending",
        submittedAt: "2026-07-12T09:00:00.000Z",
        dueAt: "2026-07-14T17:00:00.000Z",
      },
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Episode not found." });
  });

  test("strips a Copperline review-cut route when switching to Lantern", async ({ page }) => {
    await page.goto("/review");

    const response = await page.request.post("/api/organizations/active", {
      data: { organizationId: LANTERN_ORGANIZATION_ID, pathname: `/review/${COPPERLINE_CUT_ID}` },
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ redirectTo: "/" });

    await page.request.post("/api/organizations/active", {
      data: { organizationId: COPPERLINE_ORGANIZATION_ID, pathname: "/review" },
    });
  });
});
