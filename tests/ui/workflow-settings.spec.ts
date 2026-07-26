import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonError, captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.describe("Workflow and role settings UI", () => {
  test("presents one ordered workflow rather than a dependency graph", async ({ page }) => {
    await page.goto("/settings/workflow");

    await expect(page.getByRole("heading", { name: "Post workflow" })).toBeVisible();
    await expect(page.getByText("Workflow stages and sign-off roles", { exact: true })).toBeVisible();
    await expect(page.getByText("dependency", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Drag to reorder/ }).first()).toBeVisible();
  });

  test("lets a post house stage a new workflow step without persisting until Save", async ({ page }) => {
    await page.goto("/settings/workflow");
    const reorderButtons = page.getByRole("button", { name: /Drag to reorder/ });
    await expect(reorderButtons.first()).toBeVisible();
    const before = await reorderButtons.count();

    await page.getByRole("button", { name: "Add stage" }).click();
    await expect(page.locator('input[value="New stage"]')).toBeVisible();
    expect(await reorderButtons.count()).toBe(before + 1);

    await page.reload();
    await expect(page.locator('input[value="New stage"]')).toHaveCount(0);
  });

  test("lets an administrator configure a tenant role for a sign-off", async ({ page }) => {
    await page.goto("/settings/workflow");
    const addSignOff = page.getByRole("button", { name: "Add sign-off" }).first();
    await addSignOff.click();

    const role = page.getByLabel("Sign-off role 1").last();
    await expect(role).toBeVisible();
    await expect(role.locator("option").nth(1)).toHaveText(/\S/);
    const required = page.getByRole("checkbox", { name: "Require sign-off 1" }).last();
    await required.uncheck();
    await expect(required).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Save workflow" })).toBeEnabled();
  });

  test("sends the selected tenant role, rather than a free-text approval label", async ({ page }) => {
    await page.goto("/settings/workflow");
    await page.getByRole("button", { name: "Add sign-off" }).first().click();
    const role = page.getByLabel("Sign-off role 1").last();
    const roleValue = await role.locator("option").nth(1).getAttribute("value");
    expect(roleValue).toBeTruthy();
    await role.selectOption(roleValue!);
    const body = await captureJsonWrite(page, /\/v1\/workflows\/[^/]+$/u);

    await page.getByRole("button", { name: "Save workflow" }).click();

    await expect.poll(body).toMatchObject({
      rules: expect.arrayContaining([expect.objectContaining({ approver_role: roleValue })]),
    });
  });

  test("shows the server validation message when a workflow save is rejected", async ({ page }) => {
    await page.goto("/settings/workflow");
    await captureJsonError(
      page,
      /\/v1\/workflows\/[^/]+$/u,
      "Every workflow sign-off must use a role configured for this post house.",
      400,
    );

    await page.getByRole("button", { name: "Save workflow" }).click();

    await expect(page.getByRole("status")).toContainText("Every workflow sign-off must use a role configured for this post house.");
  });

  test("protects the only configured QC gate from accidental deletion", async ({ page }) => {
    await page.goto("/settings/workflow");
    const protectedDelete = page.locator('button[aria-label*="the required QC stage cannot be deleted"]');

    await expect(protectedDelete).toHaveCount(1);
    await expect(protectedDelete).toBeDisabled();
  });

  test("lets an administrator prepare a custom tenant role without saving it accidentally", async ({ page }) => {
    await page.goto("/settings/roles");
    await page.getByRole("button", { name: "Add role" }).click();

    const labels = page.getByLabel("Role label");
    await labels.last().fill("Dailies coordinator");
    await expect(labels.last()).toHaveValue("Dailies coordinator");
    await expect(page.getByRole("button", { name: "Save roles & permissions" })).toBeEnabled();

    await page.reload();
    await expect(page.locator('input[value="Dailies coordinator"]')).toHaveCount(0);
  });

  test("keeps the fixed client account type out of role-policy editing", async ({ page }) => {
    await page.goto("/settings/roles");
    const roleKeys = page.getByLabel("Role key");
    const labels = page.getByLabel("Role label");
    const clientIndex = await roleKeys.evaluateAll((elements) => elements.findIndex((element) => (element as HTMLInputElement).value === "client"));

    expect(clientIndex).toBeGreaterThanOrEqual(0);
    await expect(labels.nth(clientIndex)).toBeDisabled();
    await expect(roleKeys.nth(clientIndex)).toBeDisabled();
  });

  test("redirects an artist away from organisation workflow configuration", async ({ context, page }) => {
    await establishDebugSession(context, "user_copper_editor", COPPERLINE_ORGANIZATION_ID);
    await page.goto("/settings/workflow");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Today in post" })).toBeVisible();
  });
});
