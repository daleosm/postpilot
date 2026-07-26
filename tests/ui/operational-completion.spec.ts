import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const EPISODE_ID = "27500000-0000-4000-8000-000000000001";
const RUNNER_REQUEST_ID = "fa000000-0000-4000-8000-000000000010";
const RUNNER_REQUEST_ITEM = "UI runner receipt cost · fa000000";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for operational completion UI tests.");
const sql = postgres(databaseUrl, { prepare: false });

test.afterEach(async () => {
  await sql`delete from catering_requests where id = ${RUNNER_REQUEST_ID}`;
});

test.afterAll(async () => {
  await sql.end();
});

test.beforeEach(async ({ context }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
});

test.describe("Operational completion journeys", () => {
  test("sends a practical catering request with room, quantity, timing, and notes", async ({ page }) => {
    await page.goto("/catering");
    const room = page.getByLabel("Room");
    await room.selectOption({ index: 1 });
    await page.getByLabel("Request type").selectOption("tea_coffee");
    await page.getByLabel("What would you like?").fill("Four oat flat whites");
    await page.getByLabel("Quantity").fill("4");
    await page.getByLabel("Notes").fill("Please leave at reception.");
    const body = await captureJsonWrite(page, "**/v1/catering-requests", { id: "fa000000-0000-4000-8000-000000000001" }, 201);

    await page.getByRole("button", { name: "Send request" }).click();

    await expect.poll(body).toMatchObject({ request_type: "tea_coffee", item: "Four oat flat whites", quantity: 4, notes: "Please leave at reception." });
    await expect(page.getByRole("status")).toContainText("Request sent to the runner desk.");
  });

  test("creates a room with the details schedulers need", async ({ page }) => {
    await page.goto("/settings/rooms");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.getByLabel("Room name").fill("UI mix stage");
    await page.getByLabel("Room type").selectOption("mix_room");
    await page.getByLabel("Capacity").fill("6");
    await page.getByLabel("Location").fill("Finishing floor");
    await page.getByLabel("Notes").fill("5.1 monitoring calibrated weekly.");
    const body = await captureJsonWrite(page, "**/v1/settings/rooms", { id: "fa000000-0000-4000-8000-000000000002" }, 201);

    await page.getByRole("button", { name: "Add room", exact: true }).last().click();

    await expect.poll(body).toMatchObject({ name: "UI mix stage", type: "mix_room", capacity: 6, location: "Finishing floor" });
  });

  test("lets the runner record a receipt total after a delivery", async ({ context, page }) => {
    await sql`
      insert into catering_requests (id, organization_id, request_type, item, quantity, status, currency, created_at, updated_at)
      values (${RUNNER_REQUEST_ID}, ${COPPERLINE_ORGANIZATION_ID}, 'snack', ${RUNNER_REQUEST_ITEM}, 2, 'delivered', 'USD', now(), now())
    `;
    await establishDebugSession(context, "user_copper_runner", COPPERLINE_ORGANIZATION_ID);
    await page.goto("/runner");
    // This fixture is the only unbilled delivered request, so the runner desk
    // exposes one receipt input. Avoid coupling the journey to presentation
    // wrappers inside the responsive request row.
    await expect(page.getByText(RUNNER_REQUEST_ITEM)).toBeVisible();
    const receiptTotal = page.getByLabel("Receipt total");
    await receiptTotal.fill("14.4");
    const body = await captureJsonWrite(page, `**/v1/catering-requests/${RUNNER_REQUEST_ID}`, { status: "delivered", actual_cost: 14.4, billed_amount: 16.2 });

    await page.getByRole("button", { name: "Bill linked job" }).click();

    await expect.poll(body).toMatchObject({ status: "delivered", actual_cost: 14.4 });
  });

  test("copies a booking sequence with an explicit source, target, and first client date", async ({ page }) => {
    await page.goto("/bookings");
    await page.getByRole("button", { name: "Copy episode sequence" }).click();
    await page.getByLabel("Template episode").selectOption({ index: 1 });
    await page.getByLabel("Target episode").selectOption({ index: 2 });
    await page.getByLabel("First client booking date").fill("2034-09-09");
    const body = await captureJsonWrite(page, "**/v1/bookings/copy-episode", { copied: 4 }, 201);

    await page.getByRole("button", { name: "Copy sequence" }).click();

    await expect.poll(body).toMatchObject({ source_episode_id: expect.any(String), target_episode_id: expect.any(String), starts_on: expect.stringContaining("2034-09-09") });
  });

  test("saves reordered workflow stages through the keyboard-accessible stage controls", async ({ page }) => {
    await page.goto("/settings/workflow");
    const handles = page.getByRole("button", { name: /^Drag to reorder / });
    await expect(handles.nth(1)).toBeVisible();
    const movedName = (await handles.nth(1).getAttribute("aria-label"))?.replace("Drag to reorder ", "") ?? "";
    await handles.nth(1).press("ArrowUp");
    const body = await captureJsonWrite(page, /\/v1\/workflows\/[^/]+$/u);

    await page.getByRole("button", { name: "Save workflow" }).click();

    await expect.poll(body).toMatchObject({ stages: expect.any(Array) });
    expect((body() as { stages: Array<{ name: string; position: number }> }).stages.find((stage) => stage.name === movedName)?.position).toBe(1);
    await expect(page.getByRole("status")).toContainText("Workflow saved.");
  });

  test("saves a tenant-custom role and its compressed capability policy", async ({ page }) => {
    await page.goto("/settings/roles");
    await page.getByRole("button", { name: "Add role" }).click();
    const roleKey = page.getByLabel("Role key").last();
    await roleKey.fill("finishing_coordinator");
    await page.getByLabel("Role label").last().fill("Finishing coordinator");
    await page.getByLabel("Production operations").last().check();
    const body = await captureJsonWrite(page, "**/v1/settings/role-policies");

    await page.getByRole("button", { name: "Save roles & permissions" }).click();

    await expect.poll(body).toMatchObject({ policies: expect.arrayContaining([expect.objectContaining({ role: "finishing_coordinator", label: "Finishing coordinator", permissions: expect.arrayContaining(["manage_production"]) })]) });
    await expect(page.getByRole("status")).toContainText("Role settings saved");
  });

  test("updates an existing user without changing their global account", async ({ page }) => {
    await page.goto("/settings/users");
    await page.getByRole("button", { name: "Edit" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Account access").selectOption("member");
    const body = await captureJsonWrite(page, /\/v1\/settings\/users\/[^/]+$/u);

    await dialog.getByRole("button", { name: "Save access" }).click();

    await expect.poll(body).toMatchObject({ membership_role: "member", person_role: expect.any(String) });
    await expect(page.getByRole("status")).toContainText("User access updated.");
  });

  test("marks an eligible episode-team person as the signer for their workflow role", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_ID}`);
    await page.getByRole("button", { name: "Edit episode" }).click();
    const signer = page.locator('input[aria-label^="Workflow signer:"]:enabled').first();
    await expect(signer).toBeVisible();
    const body = await captureJsonWrite(page, `**/v1/episodes/${EPISODE_ID}/team`);

    // The write is intercepted for this UI-contract test, so use a click
    // rather than Playwright's state-waiting check()/uncheck() helpers.
    await signer.click();

    await expect.poll(body).toMatchObject({ assignment_id: expect.any(String), is_signer: expect.any(Boolean) });
  });

  test("shows an existing workflow signer as checked in Edit episode", async ({ page }) => {
    const [assignment] = await sql<{ id: string; name: string; is_lead: boolean }[]>`
      select episode_team_assignments.id, people.name, episode_team_assignments.is_lead
      from episode_team_assignments
      inner join people on people.id = episode_team_assignments.person_id
      where episode_team_assignments.organization_id = ${COPPERLINE_ORGANIZATION_ID}
        and episode_team_assignments.episode_id = ${EPISODE_ID}
        and people.role in (
          select distinct approver_role from workflow_stage_approval_rules
          where organization_id = ${COPPERLINE_ORGANIZATION_ID} and approver_role is not null
        )
      limit 1
    `;
    if (!assignment) throw new Error("Episode team fixture needs an eligible signer.");
    await sql`update episode_team_assignments set is_lead = true where id = ${assignment.id}`;
    try {
      await page.goto(`/episodes/${EPISODE_ID}`);
      await page.getByRole("button", { name: "Edit episode" }).click();
      await expect(page.getByLabel(`Workflow signer: ${assignment.name}`)).toBeChecked();
    } finally {
      await sql`update episode_team_assignments set is_lead = ${assignment.is_lead} where id = ${assignment.id}`;
    }
  });

  test("keeps non-sign-off roles assigned but disables their signer tick", async ({ page }) => {
    const [assignment] = await sql<{ person_id: string; name: string; role: string }[]>`
      select people.id as person_id, people.name, people.role
      from episode_team_assignments
      inner join people on people.id = episode_team_assignments.person_id
      where episode_team_assignments.organization_id = ${COPPERLINE_ORGANIZATION_ID}
        and episode_team_assignments.episode_id = ${EPISODE_ID}
      limit 1
    `;
    if (!assignment) throw new Error("Episode team fixture needs a person.");
    await sql`update people set role = 'ui_fixture_non_signer' where id = ${assignment.person_id}`;
    try {
      await page.goto(`/episodes/${EPISODE_ID}`);
      await page.getByRole("button", { name: "Edit episode" }).click();
      const signer = page.getByLabel(`Workflow signer: ${assignment.name}`);
      await expect(signer).toBeDisabled();
      await expect(signer.locator("xpath=..")).toHaveAttribute("title", /No workflow sign-off stage/);
    } finally {
      await sql`update people set role = ${assignment.role} where id = ${assignment.person_id}`;
    }
  });

  test("shows a signer-assignment rejection instead of changing the selection", async ({ page }) => {
    await page.goto(`/episodes/${EPISODE_ID}`);
    await page.getByRole("button", { name: "Edit episode" }).click();
    const signer = page.locator('input[aria-label^="Workflow signer:"]:enabled').first();
    await expect(signer).toBeVisible();
    await captureJsonWrite(
      page,
      `**/v1/episodes/${EPISODE_ID}/team`,
      { detail: "This person’s role is not configured for workflow sign-off." },
      409,
    );

    await signer.click();

    await expect(page.getByText("This person’s role is not configured for workflow sign-off.")).toBeVisible();
  });
});
