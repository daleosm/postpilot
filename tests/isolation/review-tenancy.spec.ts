import { expect, test } from "@playwright/test";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const LANTERN_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000004";

test.describe("Approvals tenant isolation", () => {
  test("does not preserve retired nested approval routes when switching tenants", async ({ page }) => {
    await page.goto("/review");

    const response = await page.request.post("/api/organizations/active", {
      data: { organizationId: LANTERN_ORGANIZATION_ID, pathname: "/review/10000000-0000-4000-8000-000000000001" },
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ redirectTo: "/" });

    await page.request.post("/api/organizations/active", {
      data: { organizationId: COPPERLINE_ORGANIZATION_ID, pathname: "/review" },
    });
  });
});
