import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { establishDebugSession, TEST_APP_URL } from "../fixtures/debug-session";
import { captureJsonError, captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const EPISODE_IN_PROGRESS = "27500000-0000-4000-8000-000000000001";
const EPISODE_NOT_STARTED = "27500000-0000-4000-8000-000000000002";
const EPISODE_BLOCKED = "27500000-0000-4000-8000-000000000004";
const EPISODE_CLIENT_SIGN_OFF = "27500000-0000-4000-8000-000000000007";
const TEST_APPROVAL_ID = "f5000000-0000-4000-8000-000000000001";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for workflow action UI tests.");
const sql = postgres(databaseUrl, { prepare: false });
let approvalFixturePreviousState: { workflowStageId: string; workflowStatus: string } | null = null;

test.afterEach(async () => {
  await sql`delete from episode_workflow_approvals where id = ${TEST_APPROVAL_ID}`;
  if (approvalFixturePreviousState) {
    await sql`
      update episodes
      set workflow_stage_id = ${approvalFixturePreviousState.workflowStageId}, workflow_status = ${approvalFixturePreviousState.workflowStatus}
      where id = ${EPISODE_CLIENT_SIGN_OFF} and organization_id = ${COPPERLINE_ORGANIZATION_ID}
    `;
    approvalFixturePreviousState = null;
  }
});

test.afterAll(async () => {
  await sql.end();
});

test.describe("Workflow operational actions", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("starts a not-yet-started stage through the current-stage action panel", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_NOT_STARTED}`);
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    const requestBody = await captureJsonWrite(page, `**/v1/episodes/${EPISODE_NOT_STARTED}`);

    await page.getByRole("button", { name: "Start stage" }).click();

    await expect.poll(requestBody).toMatchObject({ action: "start" });
    await expect(page.getByRole("status").filter({ hasText: "Stage started." })).toBeVisible();
  });

  test("submits active work for sign-off with the current workflow stage ID", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_IN_PROGRESS}`);
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    const requestBody = await captureJsonWrite(page, `**/v1/episodes/${EPISODE_IN_PROGRESS}`);

    await page.getByRole("button", { name: /Submit for sign-off|Submit & advance/ }).click();

    await expect.poll(requestBody).toMatchObject({ action: "submit" });
    await expect(page.getByRole("status").filter({ hasText: "Stage submitted for sign-off." })).toBeVisible();
  });

  test("requires an operational note and sends it when resuming a blocked stage", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_BLOCKED}`);
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    const resume = page.getByRole("button", { name: "Resume stage" });
    await expect(resume).toBeDisabled();
    await page.getByPlaceholder("Reason for resuming…").fill("Corrected online handover received.");
    const requestBody = await captureJsonWrite(page, `**/v1/episodes/${EPISODE_BLOCKED}`);

    await resume.click();

    await expect.poll(requestBody).toMatchObject({ action: "resume", reason: "Corrected online handover received." });
    await expect(page.getByRole("status").filter({ hasText: "Stage resumed." })).toBeVisible();
  });

  test("shows a clear server rejection instead of claiming a blocked workflow action succeeded", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_IN_PROGRESS}`);
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    await captureJsonError(page, `**/v1/episodes/${EPISODE_IN_PROGRESS}`, "A blocking work order must be completed first.");

    await page.getByRole("button", { name: /Submit for sign-off|Submit & advance/ }).click();

    await expect(page.getByRole("status").filter({ hasText: "A blocking work order must be completed first." })).toBeVisible();
  });
});

test.describe("Approval action feedback", () => {
  test("records a named episode signer’s decision from the approvals inbox", async ({ context, page }) => {
    const [signer] = await sql<{ id: string }[]>`
      select id from people where organization_id = ${COPPERLINE_ORGANIZATION_ID} and user_id = 'user_maya' limit 1
    `;
    const [rule] = await sql<{ id: string; workflow_stage_id: string }[]>`
      select workflow_stage_approval_rules.id, workflow_stage_approval_rules.workflow_stage_id
      from workflow_stage_approval_rules
      inner join workflow_stages on workflow_stages.id = workflow_stage_approval_rules.workflow_stage_id
      where workflow_stage_approval_rules.organization_id = ${COPPERLINE_ORGANIZATION_ID}
        and workflow_stages.organization_id = ${COPPERLINE_ORGANIZATION_ID}
        and workflow_stages.position = 1
      limit 1
    `;
    if (!signer || !rule) throw new Error("Copperline approval signer fixture is missing.");
    const [episode] = await sql<{ workflow_stage_id: string; workflow_status: string }[]>`
      select workflow_stage_id, workflow_status from episodes
      where id = ${EPISODE_CLIENT_SIGN_OFF} and organization_id = ${COPPERLINE_ORGANIZATION_ID}
      limit 1
    `;
    if (!episode) throw new Error("Copperline approval episode fixture is missing.");
    approvalFixturePreviousState = { workflowStageId: episode.workflow_stage_id, workflowStatus: episode.workflow_status };
    await sql`
      update episodes
      set workflow_stage_id = ${rule.workflow_stage_id}, workflow_status = 'awaiting_sign_off'
      where id = ${EPISODE_CLIENT_SIGN_OFF} and organization_id = ${COPPERLINE_ORGANIZATION_ID}
    `;
    await sql`
      insert into episode_workflow_approvals (
        id, organization_id, episode_id, workflow_stage_id, approval_rule_id,
        required_person_id, status, created_at, updated_at
      ) values (
        ${TEST_APPROVAL_ID}, ${COPPERLINE_ORGANIZATION_ID}, ${EPISODE_CLIENT_SIGN_OFF}, ${rule.workflow_stage_id}, ${rule.id},
        ${signer.id}, 'pending', now(), now()
      )
    `;
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
    const session = await context.request.get(`${TEST_APP_URL}/v1/auth/session`);
    await expect(session).toBeOK();
    await expect(session.json()).resolves.toMatchObject({
      active_organization_id: COPPERLINE_ORGANIZATION_ID,
      person: { id: signer.id },
    });
    const inbox = await context.request.get(`${TEST_APP_URL}/v1/approvals`);
    await expect(inbox).toBeOK();
    await expect(inbox.json()).resolves.toMatchObject({
      sign_offs: [expect.objectContaining({ episode_id: EPISODE_CLIENT_SIGN_OFF, approval_rule_id: rule.id })],
    });
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
    const requestBody = await captureJsonWrite(page, /\/v1\/episodes\/[^/]+$/, { stage_complete: true });

    await page.getByRole("button", { name: "Sign off" }).first().click();

    await expect.poll(requestBody).toMatchObject({ action: "sign_off" });
    await expect(page.getByRole("status").filter({ hasText: "Stage fully signed off." })).toBeVisible();
  });
});
