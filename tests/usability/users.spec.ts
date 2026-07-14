import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for user-access usability tests.");
const sql = postgres(databaseUrl, { prepare: false });
const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const testEmail = "user-access-lab@postpilot.test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "postpilot.debugUser", value: "user_maya", url: "http://localhost:5001" },
    { name: "posthouse.activeOrganizationId", value: COPPERLINE_ORGANIZATION_ID, url: "http://localhost:5001" },
  ]);
});

test.afterAll(async () => {
  await sql`delete from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and email = ${testEmail}`;
  await sql`delete from organization_members where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id in (select id from users where email = ${testEmail})`;
  await sql`delete from users where email = ${testEmail}`;
  await sql.end();
});

test.describe("User access settings", () => {
  test("adds tenant-local access using a configured post-house role", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: "Users & access" })).toBeVisible();
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add user", exact: true })).toBeVisible();
    await page.getByLabel("Name").fill("User Access Lab");
    await page.getByLabel("Work email").fill(testEmail);
    await page.getByLabel("Post-house role").selectOption("editor");
    await page.getByLabel("Account access").selectOption("member");
    await page.getByRole("button", { name: "Create user", exact: true }).click();

    await expect(page.getByText("User Access Lab", { exact: true })).toBeVisible();
    await expect(page.getByText(testEmail, { exact: true })).toBeVisible();
    await expect(page.getByText("User access created.")).toBeVisible();
  });
});
