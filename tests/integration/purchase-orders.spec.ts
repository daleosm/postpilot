import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for purchase-order integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "95000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "95000000-0000-4000-8000-000000000002";
const managerUserId = "user_po_budget_manager";
const approverUserId = "user_po_budget_approver";
const viewerUserId = "user_po_viewer";
const managerPersonId = "95000000-0000-4000-8000-000000000003";
const approverPersonId = "95000000-0000-4000-8000-000000000004";
const viewerPersonId = "95000000-0000-4000-8000-000000000005";
const vendorId = "95000000-0000-4000-8000-000000000006";
const foreignVendorId = "95000000-0000-4000-8000-000000000007";
const showId = "95000000-0000-4000-8000-000000000008";
const seasonId = "95000000-0000-4000-8000-000000000009";
const episodeId = "95000000-0000-4000-8000-000000000010";
const foreignShowId = "95000000-0000-4000-8000-000000000011";
const foreignSeasonId = "95000000-0000-4000-8000-000000000012";
const foreignEpisodeId = "95000000-0000-4000-8000-000000000013";
const workOrderId = "95000000-0000-4000-8000-000000000014";
const foreignWorkOrderId = "95000000-0000-4000-8000-000000000015";
const budgetLineId = "95000000-0000-4000-8000-000000000016";
const vendorInvoiceId = "95000000-0000-4000-8000-000000000017";
const foreignPurchaseOrderId = "95000000-0000-4000-8000-000000000018";
const draftWorkOrderId = "95000000-0000-4000-8000-000000000019";

function poPayload(overrides: Record<string, unknown> = {}) {
  return {
    vendorCompanyId: vendorId,
    showId,
    episodeId,
    poNumber: "PO-LAB-001",
    approvedAmount: 1000,
    issueDate: "2035-07-01",
    expiryDate: "2035-08-01",
    notes: "Approved external finishing support.",
    ...overrides,
  };
}

async function useSession(page: Page, userId: string) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } })).status()).toBe(200);
}

test.describe("Purchase order foundation", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${managerUserId}, 'PO Budget Manager', 'po-manager@postpilot.test'),
      (${approverUserId}, 'PO Budget Approver', 'po-approver@postpilot.test'),
      (${viewerUserId}, 'PO Viewer', 'po-viewer@postpilot.test')`;
    await sql`insert into organizations (id, name, slug, currency) values
      (${organizationId}, 'PO Lab', 'po-lab', 'GBP'),
      (${foreignOrganizationId}, 'Foreign PO Lab', 'foreign-po-lab', 'GBP')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${managerUserId}, 'member'),
      (${organizationId}, ${approverUserId}, 'member'),
      (${organizationId}, ${viewerUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'budget_manager', 'Budget manager', '["manage_budget"]'::jsonb),
      (${organizationId}, 'budget_approver', 'Budget approver', '["manage_budget","approve_budget_overruns"]'::jsonb),
      (${organizationId}, 'viewer', 'Viewer', '["view_assigned"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'PO Budget Manager', 'po-manager@postpilot.test', 'budget_manager'),
      (${approverPersonId}, ${organizationId}, ${approverUserId}, 'PO Budget Approver', 'po-approver@postpilot.test', 'budget_approver'),
      (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'PO Viewer', 'po-viewer@postpilot.test', 'viewer')`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values
      (${vendorId}, ${organizationId}, 'PO Lab Finishing Vendor', 'vendor', 'GBP'),
      (${foreignVendorId}, ${foreignOrganizationId}, 'Foreign PO Vendor', 'vendor', 'GBP')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values
      (${showId}, ${organizationId}, 'PO Lab Series', 'POL', 'Europe/London'),
      (${foreignShowId}, ${foreignOrganizationId}, 'Foreign PO Series', 'FPOL', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values
      (${seasonId}, ${organizationId}, ${showId}, 1),
      (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values
      (${episodeId}, ${organizationId}, ${seasonId}, 1, 'PO episode', 'assembly', 'not_started'),
      (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'Foreign PO episode', 'assembly', 'not_started')`;
    await sql`insert into post_work_orders (id, organization_id, episode_id, vendor_company_id, title, status) values
      (${workOrderId}, ${organizationId}, ${episodeId}, ${vendorId}, 'External finishing support', 'in_progress'),
      (${draftWorkOrderId}, ${organizationId}, ${episodeId}, ${vendorId}, 'Draft finishing support', 'open'),
      (${foreignWorkOrderId}, ${foreignOrganizationId}, ${foreignEpisodeId}, ${foreignVendorId}, 'Foreign finishing support', 'in_progress')`;
    await sql`insert into budget_lines (id, organization_id, show_id, season_id, episode_id, category, budgeted_amount, actual_amount, currency, cost_type, external_cost) values
      (${budgetLineId}, ${organizationId}, ${showId}, ${seasonId}, ${episodeId}, 'Finishing', '500.00', '0.00', 'GBP', 'internal', true)`;
    await sql`insert into vendor_invoices (id, organization_id, vendor_company_id, work_order_id, show_id, episode_id, invoice_number, amount, currency, status) values
      (${vendorInvoiceId}, ${organizationId}, ${vendorId}, ${workOrderId}, ${showId}, ${episodeId}, 'PO-LAB-V-001', '600.00', 'GBP', 'received')`;
    await sql`insert into purchase_orders (id, organization_id, vendor_company_id, show_id, episode_id, po_number, currency, approved_amount, status) values
      (${foreignPurchaseOrderId}, ${foreignOrganizationId}, ${foreignVendorId}, ${foreignShowId}, ${foreignEpisodeId}, 'FOREIGN-PO-001', 'GBP', '1000.00', 'approved')`;
  });

  test.beforeEach(async () => {
    await sql`delete from purchase_order_allocations where organization_id = ${organizationId}`;
    await sql`delete from purchase_orders where organization_id = ${organizationId}`;
    await sql`delete from activity_log where organization_id = ${organizationId} and entity_type = 'purchase_order'`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${approverUserId}, ${viewerUserId})`;
    await sql.end();
  });

  test("calculates authorised, committed, actual, remaining, and variance from live allocations", async ({ page }) => {
    await useSession(page, managerUserId);
    expect((await page.request.post("/api/purchase-orders", { data: poPayload({ status: "approved" }) })).status()).toBe(403);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload() });
    expect(create.status()).toBe(201);
    const purchaseOrderId = (await create.json()).id as string;
    expect((await page.request.get("/api/purchase-orders")).status()).toBe(200);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(403);

    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);

    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 600, allocationDate: "2035-07-02", reference: "WO-001" } })).status()).toBe(201);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "vendor_invoice", vendorInvoiceId, amount: 600, allocationDate: "2035-07-03", reference: "PO-LAB-V-001" } })).status()).toBe(201);
    let detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ authorisedAmount: 1000, committedAmount: 600, actualInvoicedAmount: 600, remainingAmount: 400, varianceAmount: -400 });

    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "budget_line", budgetLineId, amount: 500, allocationDate: "2035-07-04", overrunReason: "The supplier added a required mastering pass." } })).status()).toBe(403);
    await useSession(page, approverUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "budget_line", budgetLineId, amount: 500, allocationDate: "2035-07-04", overrunReason: "The supplier added a required mastering pass." } })).status()).toBe(201);
    detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ committedAmount: 1100, actualInvoicedAmount: 600, remainingAmount: -100, varianceAmount: -400 });
  });

  test("does not permit calculated balances, non-draft edits, or unapproved allocation", async ({ page }) => {
    await useSession(page, managerUserId);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-002" }) });
    const purchaseOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { committedAmount: 1, notes: "Attempted balance edit" } })).status()).toBe(400);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 50, allocationDate: "2035-07-02" } })).status()).toBe(409);
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);
    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId: draftWorkOrderId, amount: 50, allocationDate: "2035-07-02" } })).status()).toBe(409);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { notes: "Late edit" } })).status()).toBe(409);
  });

  test("records the PO lifecycle in the organisation audit trail", async ({ page }) => {
    await useSession(page, managerUserId);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-AUDIT-001" }) });
    const purchaseOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { notes: "Revised finishing approval." } })).status()).toBe(200);

    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);

    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 250, allocationDate: "2035-07-02", reference: "WO-AUDIT" } })).status()).toBe(201);

    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "closed" } })).status()).toBe(200);
    const [rows] = await sql`select coalesce(json_agg(action order by created_at), '[]'::json) as actions from activity_log where organization_id = ${organizationId} and entity_type = 'purchase_order' and entity_id = ${purchaseOrderId}`;
    expect(rows.actions).toEqual(expect.arrayContaining(["purchase_order.created", "purchase_order.updated", "purchase_order.approved", "purchase_order.allocated", "purchase_order.closed"]));
  });

  test("records a PO supplier actual as one invoice allocation and one live budget actual", async ({ page }) => {
    await useSession(page, managerUserId);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-ACTUAL-001", approvedAmount: 900 }) });
    const purchaseOrderId = (await create.json()).id as string;
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);

    await useSession(page, managerUserId);
    const actual = await page.request.post(`/api/purchase-orders/${purchaseOrderId}/actual-costs`, { data: { invoiceNumber: "FIN-2048", invoiceDate: "2035-07-08", amount: 312.45, description: "Caption correction and verification", externalDocumentUrl: "https://vendor.example.test/invoices/FIN-2048" } });
    expect(actual.status()).toBe(201);
    const [invoice] = await sql`select id, vendor_company_id, show_id, episode_id, invoice_number, amount, invoice_date, external_document_url from vendor_invoices where organization_id = ${organizationId} and invoice_number = 'FIN-2048'`;
    expect(invoice).toMatchObject({ vendor_company_id: vendorId, show_id: showId, episode_id: episodeId, invoice_number: "FIN-2048", amount: "312.45", external_document_url: "https://vendor.example.test/invoices/FIN-2048" });
    expect(invoice.invoice_date.toISOString().slice(0, 10)).toBe("2035-07-08");
    const [line] = await sql`select purchase_order_id, vendor_invoice_id, actual_amount, external_cost from budget_lines where organization_id = ${organizationId} and vendor_invoice_id = ${invoice.id}`;
    expect(line).toMatchObject({ purchase_order_id: purchaseOrderId, vendor_invoice_id: invoice.id, actual_amount: "312.45", external_cost: true });
    const [allocation] = await sql`select purchase_order_id, vendor_invoice_id, allocation_type, amount from purchase_order_allocations where organization_id = ${organizationId} and vendor_invoice_id = ${invoice.id}`;
    expect(allocation).toMatchObject({ purchase_order_id: purchaseOrderId, vendor_invoice_id: invoice.id, allocation_type: "vendor_invoice", amount: "312.45" });
    const detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ actualInvoicedAmount: 312.45, committedAmount: 0, remainingAmount: 900 });
    expect(detail.allocations[0]).toMatchObject({ externalDocumentUrl: "https://vendor.example.test/invoices/FIN-2048" });
    expect(detail.activity.map((event: { action: string }) => event.action)).toContain("purchase_order.invoice_recorded");
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/actual-costs`, { data: { invoiceNumber: "FIN-2048", invoiceDate: "2035-07-08", amount: 312.45, description: "Duplicate" } })).status()).toBe(409);
    expect((await page.request.post(`/api/purchase-orders/${foreignPurchaseOrderId}/actual-costs`, { data: { invoiceNumber: "FOREIGN-1", invoiceDate: "2035-07-08", amount: 10, description: "Foreign attempt" } })).status()).toBe(404);
  });

  test("rejects foreign PO, vendor, and allocation-source IDs without disclosure", async ({ page }) => {
    await useSession(page, managerUserId);
    expect((await page.request.post("/api/purchase-orders", { data: poPayload({ vendorCompanyId: foreignVendorId, poNumber: "PO-LAB-FOREIGN" }) })).status()).toBe(404);
    expect((await page.request.get(`/api/purchase-orders/${foreignPurchaseOrderId}`)).status()).toBe(404);

    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-003" }) });
    const purchaseOrderId = (await create.json()).id as string;
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);
    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId: foreignWorkOrderId, amount: 10, allocationDate: "2035-07-02" } })).status()).toBe(404);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { organizationId: foreignOrganizationId, allocationType: "work_order", workOrderId, amount: 10, allocationDate: "2035-07-02" } })).status()).toBe(400);
  });

  test("keeps PO reads and mutations behind budget capabilities", async ({ page }) => {
    await useSession(page, viewerUserId);
    expect((await page.request.get("/api/purchase-orders")).status()).toBe(403);
    expect((await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-004" }) })).status()).toBe(403);
  });

  test("creates a draft and opens its live register detail through the Budget UI", async ({ page }) => {
    await useSession(page, managerUserId);
    await page.goto("/budget/purchase-orders");
    await expect(page.getByRole("heading", { name: "Purchase Orders" })).toBeVisible();
    await page.getByRole("button", { name: "New PO" }).click();
    await page.getByLabel("Vendor").selectOption(vendorId);
    await page.getByLabel("PO number").fill("PO-LAB-UI-001");
    await page.getByLabel("Authorised value (GBP)").fill("825");
    await page.getByLabel("Show").selectOption(showId);
    await page.getByLabel("Notes").fill("UI-created vendor authorisation.");
    await page.getByRole("button", { name: "Create draft PO" }).click();
    await expect(page).toHaveURL(/\/budget\/purchase-orders\//);
    await expect(page.getByRole("heading", { name: "PO-LAB-UI-001" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Allocation ledger" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  });
});
