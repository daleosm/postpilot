import { expect, test } from "@playwright/test";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const LANTERN_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000004";
const COPPERLINE_SHOW_ID = "25500000-0000-4000-8000-000000000001";
const LANTERN_SHOW_ID = "25400000-0000-4000-8000-000000000001";

test.describe("Shows tenant isolation", () => {
  test("does not render a Lantern show when Copperline is the active tenant", async ({ page }) => {
    await page.goto(`/shows/${LANTERN_SHOW_ID}`);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("City of Ash")).not.toBeVisible();
  });

  test("rejects a cross-tenant Show PATCH without changing the target show", async ({ page }) => {
    await page.goto("/shows");

    const response = await page.request.patch(`/api/shows/${LANTERN_SHOW_ID}`, {
      data: { title: "Cross-tenant overwrite attempt" },
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Show not found." });

    await page.goto(`/shows/${LANTERN_SHOW_ID}`);
    await expect(page.getByText("City of Ash")).not.toBeVisible();
  });

  test("strips a Copperline show route when switching to Lantern", async ({ page }) => {
    await page.goto("/shows");

    const response = await page.request.post("/api/organizations/active", {
      data: {
        organizationId: LANTERN_ORGANIZATION_ID,
        pathname: `/shows/${COPPERLINE_SHOW_ID}`,
      },
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ redirectTo: "/" });

    // Restore the default tenant so this test leaves the browser context in a
    // predictable state if it is expanded with additional journeys later.
    await page.request.post("/api/organizations/active", {
      data: { organizationId: COPPERLINE_ORGANIZATION_ID, pathname: "/shows" },
    });
  });
});
