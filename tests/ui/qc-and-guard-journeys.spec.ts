import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";
import { captureJsonWrite } from "../fixtures/ui-api";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const FAILED_QC_EPISODE_ID = "27500000-0000-4000-8000-000000000004";

test.describe("QC recovery UI", () => {
  test.beforeEach(async ({ context }) => {
    await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  });

  test("starts a re-QC run after a failed report and records the external report reference", async ({ page }) => {
    await page.goto(`/episodes/${FAILED_QC_EPISODE_ID}`);
    await page.getByRole("button", { name: "QC", exact: true }).click();
    await expect(page.getByText("Start re-QC").first()).toBeVisible();
    await page.getByLabel("External report link").fill("https://qc.example.test/reports/UI-RECHECK");
    await page.getByLabel("Summary").fill("Corrected master submitted for re-QC.");
    const body = await captureJsonWrite(page, "**/v1/qc-reports", { id: "fc000000-0000-4000-8000-000000000001", status: "in_progress" }, 201);

    await page.getByRole("button", { name: "Start re-QC" }).last().click();

    await expect.poll(body).toMatchObject({ episode_id: FAILED_QC_EPISODE_ID, status: "in_progress", report_url: "https://qc.example.test/reports/UI-RECHECK", summary: "Corrected master submitted for re-QC." });
    await expect(page.getByRole("status")).toContainText("QC result recorded.");
  });

  test("logs a QC exception with timecode and sends its technical details", async ({ page }) => {
    await page.goto(`/episodes/${FAILED_QC_EPISODE_ID}`);
    await page.getByRole("button", { name: "QC", exact: true }).click();
    await expect(page.getByText("Log QC exception")).toBeVisible();
    await page.locator('input[name="code"]').fill("UI-CAP-104");
    await page.getByLabel("Severity").selectOption("major");
    await page.getByLabel(/Timecode/).fill("1432.25");
    await page.getByLabel("Exception description").fill("Caption cue overlaps the on-screen locator.");
    const body = await captureJsonWrite(page, "**/v1/qc-issues", { id: "fc000000-0000-4000-8000-000000000002", status: "open" }, 201);

    await page.getByRole("button", { name: "Log exception" }).click();

    await expect.poll(body).toMatchObject({ severity: "major", code: "UI-CAP-104", timecode_seconds: 1432.25, description: "Caption cue overlaps the on-screen locator.", qc_report_id: expect.any(String) });
    await expect(page.getByRole("status")).toContainText("QC issue logged.");
  });

  test("requires a verifier note before resolving a live QC exception", async ({ page }) => {
    await page.goto(`/episodes/${FAILED_QC_EPISODE_ID}`);
    await page.getByRole("button", { name: "QC", exact: true }).click();
    const issue = page.getByText("PHOTOSENS-01").locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]");
    await expect(issue).toBeVisible();
    const resolve = issue.getByRole("button", { name: "Verify & resolve" });
    await expect(resolve).toBeDisabled();
    await issue.getByPlaceholder("Verification note required to close").fill("Regraded transition checked at 00:30:17.");
    const body = await captureJsonWrite(page, /\/v1\/qc-issues\/[^/]+$/u, { status: "resolved", resolution: "Regraded transition checked at 00:30:17." });

    await resolve.click();

    await expect.poll(body).toMatchObject({ status: "resolved", resolution: "Regraded transition checked at 00:30:17." });
    await expect(page.getByRole("status")).toContainText("QC issue resolved.");
  });
});

test.describe("Direct-route client safeguards", () => {
  test("does not allow a client to enter commercial or facility pages through a typed URL", async ({ context, page }) => {
    await establishDebugSession(context, "user_copper_client", COPPERLINE_ORGANIZATION_ID);

    await page.goto("/budget");
    await expect(page.getByRole("heading", { name: "Budget" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Clients & vendors", exact: true })).toHaveCount(0);

    await page.goto("/bookings", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Bookings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Runner desk", exact: true })).toHaveCount(0);
  });
});
