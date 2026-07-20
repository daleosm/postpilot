import { expect, test } from "@playwright/test";

test.describe("Operational workspaces UI", () => {
  test("renders the live command center rather than a marketing or placeholder screen", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Post-production command center" })).toBeVisible();
    await expect(page.getByText("Active shows", { exact: true })).toBeVisible();
    await expect(page.getByText("Suite utilization", { exact: true })).toBeVisible();
    await expect(page.getByText("Artist workload", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent activity", { exact: true })).toBeVisible();
  });

  test("opens commercial registers and keeps vendor and client PO records separate", async ({ page }) => {
    await page.goto("/crm");
    await expect(page.getByRole("heading", { name: "Clients & vendors" })).toBeVisible();
    await expect(page.getByText("Accounts", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New account" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter an account name.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.goto("/budget/purchase-orders");
    await expect(page.getByRole("heading", { name: "Purchase Orders" })).toBeVisible();
    await expect(page.getByText("PO register", { exact: true })).toBeVisible();

    await page.goto("/budget/client-purchase-orders");
    await expect(page.getByRole("heading", { name: "Client POs" })).toBeVisible();
    await expect(page.getByText("Client PO register", { exact: true })).toBeVisible();
  });

  test("renders people, catering, runner, and room operations with their intended controls", async ({ page }) => {
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByText("Availability", { exact: true })).toBeVisible();

    await page.goto("/catering");
    await expect(page.getByRole("heading", { name: "Catering", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Request catering" })).toBeVisible();
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Choose a booking or room and describe the request.")).toBeVisible();

    await page.goto("/runner");
    await expect(page.getByRole("heading", { name: "Runner desk" })).toBeVisible();

    await page.goto("/settings/rooms");
    await expect(page.locator("h1", { hasText: "Rooms & suites" })).toBeVisible();
    await page.getByRole("button", { name: "Add room" }).click();
    await page.locator("form").getByRole("button", { name: "Add room", exact: true }).click();
    await expect(page.getByText("Room name is required.", { exact: true })).toBeVisible();
  });

  test("keeps commercial settings editable through dedicated tenant-local pages", async ({ page }) => {
    await page.goto("/settings/currency");
    await expect(page.getByRole("heading", { name: "Currency", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save currency" })).toBeVisible();

    await page.goto("/settings/invoicing");
    await expect(page.getByRole("heading", { name: "Invoicing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save invoicing settings" })).toBeVisible();

    await page.goto("/settings/catering");
    await expect(page.getByRole("heading", { name: "Catering billing" })).toBeVisible();
    await expect(page.getByText("Set how runner-paid catering costs are marked up", { exact: false })).toBeVisible();
  });
});
