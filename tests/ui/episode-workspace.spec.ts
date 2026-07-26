import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const COPPERLINE_EPISODE_ID = "27500000-0000-4000-8000-000000000001";

async function openEpisode(page: import("@playwright/test").Page) {
  await page.goto(`/episodes/${COPPERLINE_EPISODE_ID}`);
  await expect(page.getByRole("heading", { name: "Westbound" })).toBeVisible();
}

test.describe("Episode operational workspace UI", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("shows an episode overview built from live operational summaries", async ({ page }) => {
    await openEpisode(page);

    await expect(page.getByText("Current workflow", { exact: true })).toBeVisible();
    await expect(page.getByText("Derived workflow state", { exact: true })).toBeVisible();
    await expect(page.getByText("Booked room time", { exact: true })).toBeVisible();
    await expect(page.getByText("Episode actions", { exact: true })).toBeVisible();
  });

  test("keeps workflow in a compact ordered path with a single selected-stage panel", async ({ page }) => {
    await openEpisode(page);
    await page.getByRole("button", { name: "Workflow", exact: true }).click();

    await expect(page.getByLabel("Episode workflow")).toBeVisible();
    await expect(page.getByText(/Stage \d+ of \d+/)).toBeVisible();
    const stageButtons = page.getByRole("button", { name: /^Select / });
    expect(await stageButtons.count()).toBeGreaterThan(3);
    await stageButtons.nth(1).click();
    await expect(page.getByText("Selected stage", { exact: true })).toBeVisible();
  });

  test("keeps QC reporting and exception history in the dedicated QC tab", async ({ page }) => {
    await openEpisode(page);
    await page.getByRole("button", { name: "QC", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Quality control" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Record QC result|Start re-QC/ })).toBeVisible();
    await expect(page.getByText("QC exceptions", { exact: true })).toBeVisible();
    await expect(page.getByText("Issue log", { exact: true })).toBeVisible();
  });

  test("keeps work orders, booking history, delivery, budget, and activity in focused tabs", async ({ page }) => {
    await openEpisode(page);
    for (const tab of ["Work orders", "Bookings", "Delivery manifest", "Budget", "Activity"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.getByRole("button", { name: tab, exact: true })).toHaveClass(/text-\[#385c54\]/);
    }
  });

  test("opens the edit-episode workflow team controls for a production manager", async ({ page }) => {
    await openEpisode(page);
    await expect.poll(() => page.locator(".episode-tab-panel").evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    await page.getByRole("button", { name: "Edit episode" }).click();
    const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Edit episode" }) });

    await expect(page.getByRole("heading", { name: "Edit episode" })).toBeVisible();
    await expect(form.locator("..")).toHaveCSS("z-index", "100");
    await expect(form.getByText("Episode team", { exact: true })).toBeVisible();
    await expect(form.getByText("Signer", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("does not expose commercial budget information to an assigned editor", async ({ context, page }) => {
    await establishDebugSession(context, "user_copper_editor", COPPERLINE_ORGANIZATION_ID);
    await openEpisode(page);

    await expect(page.getByRole("button", { name: "Budget", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Work orders", exact: true })).toBeVisible();
  });
});
