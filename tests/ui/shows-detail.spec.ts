import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const CROSSING_POINT_SHOW_ID = "25500000-0000-4000-8000-000000000001";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.describe("Show detail UI", () => {
  test("shows the production workspace and opens the edit form", async ({ page }) => {
    await page.goto(`/shows/${CROSSING_POINT_SHOW_ID}`);

    await expect(page.getByRole("heading", { name: "Crossing Point" })).toBeVisible();
    await expect(page.getByText("Show contacts", { exact: true })).toBeVisible();
    await expect(page.getByText("Episode board", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent workflow completions", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit show" }).click();
    await expect(page.getByRole("heading", { name: "Edit show" })).toBeVisible();
    await expect(page.getByLabel("Show title")).toHaveValue("Crossing Point");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("keeps the show workspace focused on seasons and episode work", async ({ page }) => {
    await page.goto(`/shows/${CROSSING_POINT_SHOW_ID}`);

    await expect(page.getByText("Seasons & episodes", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Episode team", { exact: true })).toHaveCount(0);
  });

  test("lists every episode for a selected season without leaving the show workspace", async ({ page }) => {
    await page.goto(`/shows/${CROSSING_POINT_SHOW_ID}`);

    await page.getByRole("button", { name: "View episodes" }).first().click();
    await expect(page.getByRole("heading", { name: "Season 1 episodes" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Season 1 episodes" }).getByRole("link")).toHaveCount(4);
    await page.getByRole("button", { name: "Close season episodes" }).click();
    await expect(page.getByRole("heading", { name: "Season 1 episodes" })).not.toBeVisible();
  });

  test("keeps the show board to the five most recent episodes", async ({ page }) => {
    await page.goto(`/shows/${CROSSING_POINT_SHOW_ID}`);

    expect(await page.locator("#episode-board").getByRole("link").count()).toBeLessThanOrEqual(5);
  });

  test("does not render the show workspace for an artist without Shows permission", async ({ context, page }) => {
    await establishDebugSession(context, "user_copper_editor", COPPERLINE_ORGANIZATION_ID);
    await page.goto(`/shows/${CROSSING_POINT_SHOW_ID}`);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("Crossing Point")).not.toBeVisible();
  });
});
