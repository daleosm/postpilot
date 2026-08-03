import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const COPPERLINE_EPISODE_ID = "27500000-0000-4000-8000-000000000001";

test.describe("Motion and loading polish", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("keeps an active tab marker and a compact content transition in the episode workspace", async ({ page }) => {
    await page.goto(`/episodes/${COPPERLINE_EPISODE_ID}`);

    const workflowTab = page.getByRole("button", { name: "Workflow", exact: true });
    await workflowTab.click();
    await expect(workflowTab).toHaveAttribute("data-active", "true");
    await expect(page.locator(".episode-tab-panel")).toBeVisible();
  });

  test("honours reduced-motion preferences", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/episodes/${COPPERLINE_EPISODE_ID}`);
    await page.getByRole("button", { name: "Workflow", exact: true }).click();

    await expect.poll(() => page.locator(".episode-tab-panel").evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.00001);
  });
});
