import { expect, test } from "@playwright/test";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const CROSSING_POINT_SHOW_ID = "25500000-0000-4000-8000-000000000001";

test.describe("Debug logout", () => {
  test("clears the demo actor and requires an explicit debug sign-in to regain access", async ({ page, context }) => {
    await page.goto("/shows");
    await expect(page.getByRole("heading", { name: "Shows in post" })).toBeVisible();

    // Exercise a real selected debug actor and both tenant-scoped context
    // cookies. A debug logout must clear all three rather than restoring the
    // convenient default demo identity on the next request.
    expect((await page.request.post("/api/debug/user", { data: { userId: "user_maya" } })).status()).toBe(200);
    expect((await page.request.post("/api/organizations/active", { data: { organizationId: COPPERLINE_ORGANIZATION_ID, pathname: "/shows" } })).status()).toBe(200);
    expect((await page.request.post("/api/active-show", { data: { showId: CROSSING_POINT_SHOW_ID } })).status()).toBe(200);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    const cookieNames = (await context.cookies()).map((cookie) => cookie.name);
    expect(cookieNames).not.toContain("posthouse.activeOrganizationId");
    expect(cookieNames).not.toContain("postpilot.activeShow");
    expect((await context.cookies()).find((cookie) => cookie.name === "postpilot.debugUser")?.value).toBe("signed-out");
    expect((await page.request.delete("/api/debug/user")).status()).toBe(200);
    expect((await context.cookies()).find((cookie) => cookie.name === "postpilot.debugUser")?.value).toBe("signed-out");

    await page.goto("/shows");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fshows/);

    const blockedMutation = await page.request.post("/api/active-show", {
      data: { showId: CROSSING_POINT_SHOW_ID },
      maxRedirects: 0,
    });
    expect(blockedMutation.status()).toBe(307);
    expect(blockedMutation.headers().location).toContain("/sign-in");

    await page.getByRole("button", { name: "Open demo workspace" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/shows");
    await expect(page.getByRole("heading", { name: "Shows in post" })).toBeVisible();
  });
});
