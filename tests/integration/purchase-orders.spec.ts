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
const alternateVendorId = "95000000-0000-4000-8000-000000000020";
const alternateShowId = "95000000-0000-4000-8000-000000000021";
const alternateSeasonId = "95000000-0000-4000-8000-000000000022";
const alternateEpisodeId = "95000000-0000-4000-8000-000000000023";
const sameShowOtherEpisodeId = "95000000-0000-4000-8000-000000000024";
const alternateVendorInvoiceId = "95000000-0000-4000-8000-000000000025";
const alternateEpisodeInvoiceId = "95000000-0000-4000-8000-000000000026";
const alternateShowInvoiceId = "95000000-0000-4000-8000-000000000027";
const internalBudgetLineId = "95000000-0000-4000-8000-000000000028";
const foreignManagerPersonId = "95000000-0000-4000-8000-000000000029";

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

async function useOrganizationSession(page: Page, userId: string, activeOrganizationId: string) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId: activeOrganizationId, pathname: "/budget" } })).status()).toBe(200);
}

async function createApprovedPurchaseOrder(page: Page, overrides: Record<string, unknown> = {}) {
  expect((await page.request.post("/api/debug/user", { data: { userId: managerUserId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } })).status()).toBe(200);
  const create = await page.request.post("/api/purchase-orders", { data: poPayload(overrides) });
  expect(create.status()).toBe(201);
  const purchaseOrderId = (await create.json()).id as string;
  expect((await page.request.post("/api/debug/user", { data: { userId: approverUserId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } })).status()).toBe(200);
  expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);
  expect((await page.request.post("/api/debug/user", { data: { userId: managerUserId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } })).status()).toBe(200);
  return purchaseOrderId;
}

test.describe("Purchase order foundation", () => {
  // Each test resets its own fixture state, so failures should not prevent the
  // remaining commercial controls from being evaluated.
  test.describe.configure({ mode: "default" });

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
      (${organizationId}, ${viewerUserId}, 'member'),
      (${foreignOrganizationId}, ${managerUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'budget_manager', 'Budget manager', '["manage_budget","manage_work_orders"]'::jsonb),
      (${organizationId}, 'budget_approver', 'Budget approver', '["manage_budget","approve_budget_overruns"]'::jsonb),
      (${organizationId}, 'viewer', 'Viewer', '["view_assigned"]'::jsonb),
      (${foreignOrganizationId}, 'budget_manager', 'Budget manager', '["manage_budget"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'PO Budget Manager', 'po-manager@postpilot.test', 'budget_manager'),
      (${approverPersonId}, ${organizationId}, ${approverUserId}, 'PO Budget Approver', 'po-approver@postpilot.test', 'budget_approver'),
      (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'PO Viewer', 'po-viewer@postpilot.test', 'viewer'),
      (${foreignManagerPersonId}, ${foreignOrganizationId}, ${managerUserId}, 'Foreign PO Budget Manager', 'po-manager@postpilot.test', 'budget_manager')`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values
      (${vendorId}, ${organizationId}, 'PO Lab Finishing Vendor', 'vendor', 'GBP'),
      (${alternateVendorId}, ${organizationId}, 'PO Lab Alternate Vendor', 'vendor', 'GBP'),
      (${foreignVendorId}, ${foreignOrganizationId}, 'Foreign PO Vendor', 'vendor', 'GBP')`;
    await sql`insert into shows (id, organization_id, title, code, time_zone) values
      (${showId}, ${organizationId}, 'PO Lab Series', 'POL', 'Europe/London'),
      (${alternateShowId}, ${organizationId}, 'PO Lab Other Series', 'POO', 'Europe/London'),
      (${foreignShowId}, ${foreignOrganizationId}, 'Foreign PO Series', 'FPOL', 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values
      (${seasonId}, ${organizationId}, ${showId}, 1),
      (${alternateSeasonId}, ${organizationId}, ${alternateShowId}, 1),
      (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values
      (${episodeId}, ${organizationId}, ${seasonId}, 1, 'PO episode', 'assembly', 'not_started'),
      (${sameShowOtherEpisodeId}, ${organizationId}, ${seasonId}, 2, 'PO same-show other episode', 'assembly', 'not_started'),
      (${alternateEpisodeId}, ${organizationId}, ${alternateSeasonId}, 1, 'PO other-show episode', 'assembly', 'not_started'),
      (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'Foreign PO episode', 'assembly', 'not_started')`;
    await sql`insert into post_work_orders (id, organization_id, episode_id, vendor_company_id, title, status) values
      (${workOrderId}, ${organizationId}, ${episodeId}, ${vendorId}, 'External finishing support', 'in_progress'),
      (${draftWorkOrderId}, ${organizationId}, ${episodeId}, ${vendorId}, 'Draft finishing support', 'open'),
      (${foreignWorkOrderId}, ${foreignOrganizationId}, ${foreignEpisodeId}, ${foreignVendorId}, 'Foreign finishing support', 'in_progress')`;
    await sql`insert into budget_lines (id, organization_id, show_id, season_id, episode_id, category, budgeted_amount, actual_amount, currency, cost_type, external_cost) values
      (${budgetLineId}, ${organizationId}, ${showId}, ${seasonId}, ${episodeId}, 'Finishing', '500.00', '0.00', 'GBP', 'internal', true),
      (${internalBudgetLineId}, ${organizationId}, ${showId}, ${seasonId}, ${episodeId}, 'Internal editorial', '500.00', '0.00', 'GBP', 'internal', false)`;
    await sql`insert into vendor_invoices (id, organization_id, vendor_company_id, work_order_id, show_id, episode_id, invoice_number, amount, currency, status) values
      (${vendorInvoiceId}, ${organizationId}, ${vendorId}, ${workOrderId}, ${showId}, ${episodeId}, 'PO-LAB-V-001', '600.00', 'GBP', 'received'),
      (${alternateVendorInvoiceId}, ${organizationId}, ${alternateVendorId}, ${workOrderId}, ${showId}, ${episodeId}, 'PO-LAB-V-ALT-VENDOR', '600.00', 'GBP', 'received'),
      (${alternateEpisodeInvoiceId}, ${organizationId}, ${vendorId}, ${workOrderId}, ${showId}, ${sameShowOtherEpisodeId}, 'PO-LAB-V-ALT-EPISODE', '600.00', 'GBP', 'received'),
      (${alternateShowInvoiceId}, ${organizationId}, ${vendorId}, ${workOrderId}, ${alternateShowId}, ${alternateEpisodeId}, 'PO-LAB-V-ALT-SHOW', '600.00', 'GBP', 'received')`;
    await sql`insert into purchase_orders (id, organization_id, vendor_company_id, show_id, episode_id, po_number, currency, approved_amount, status) values
      (${foreignPurchaseOrderId}, ${foreignOrganizationId}, ${foreignVendorId}, ${foreignShowId}, ${foreignEpisodeId}, 'FOREIGN-PO-001', 'GBP', '1000.00', 'approved')`;
  });

  test.beforeEach(async () => {
    await sql`delete from purchase_order_allocations where organization_id = ${organizationId}`;
    await sql`delete from budget_lines where organization_id = ${organizationId} and id <> ${budgetLineId} and id <> ${internalBudgetLineId}`;
    await sql`delete from vendor_invoices where organization_id = ${organizationId} and id <> ${vendorInvoiceId} and id <> ${alternateVendorInvoiceId} and id <> ${alternateEpisodeInvoiceId} and id <> ${alternateShowInvoiceId}`;
    await sql`delete from purchase_orders where organization_id = ${organizationId}`;
    await sql`delete from activity_log where organization_id = ${organizationId} and entity_type = 'purchase_order'`;
    await sql`update budget_lines set purchase_order_id = null, external_cost = case when id = ${budgetLineId} then true else false end where organization_id = ${organizationId}`;
    await sql`update post_work_orders set work_type = 'external_vendor', vendor_company_id = ${vendorId}, purchase_order_id = null, estimated_amount = null, status = case when id = ${draftWorkOrderId} then 'open'::work_order_status else 'in_progress'::work_order_status end where organization_id = ${organizationId}`;
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
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { status: "approved" } })).status()).toBe(200);

    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 600, allocationDate: "2035-07-02", reference: "WO-001" } })).status()).toBe(201);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "vendor_invoice", vendorInvoiceId, amount: 600, allocationDate: "2035-07-03", reference: "PO-LAB-V-001" } })).status()).toBe(201);
    let detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ authorisedAmount: 1000, committedAmount: 600, actualInvoicedAmount: 600, remainingAmount: 400, varianceAmount: -400 });

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

  test("prevents a vendor invoice from being allocated to the same PO twice", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-DUPLICATE-INVOICE", approvedAmount: 2000 });
    const allocation = { allocationType: "vendor_invoice", vendorInvoiceId, amount: 600, allocationDate: "2035-07-03", reference: "PO-LAB-V-001" };
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: allocation })).status()).toBe(201);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: allocation })).status()).toBe(409);
    const detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ actualInvoicedAmount: 600 });
  });

  test("requires the PO overrun process when a linked budget line is increased", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-BUDGET-EDIT", approvedAmount: 100 });
    const create = await page.request.post("/api/budget-lines", { data: { episodeId, category: "External finishing", description: "Initial vendor scope", budgetedAmount: 80, actualAmount: 0, costType: "internal", externalCost: true, purchaseOrderId } });
    expect(create.status()).toBe(201);
    const lineId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/budget-lines/${lineId}`, { data: { budgetedAmount: 120 } })).status()).toBe(400);
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/budget-lines/${lineId}`, { data: { budgetedAmount: 120 } })).status()).toBe(400);
    expect((await page.request.patch(`/api/budget-lines/${lineId}`, { data: { budgetedAmount: 120, overrunReason: "Approved supplier finishing scope increased after review." } })).status()).toBe(200);
    const detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ committedAmount: 120, remainingAmount: -20 });
  });

  test("rejects allocation sources with a mismatched vendor, show, episode, or internal cost type", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-SCOPE-COMPATIBILITY" });
    const payload = (allocationType: string, source: Record<string, string>) => ({ allocationType, ...source, amount: 50, allocationDate: "2035-07-03" });
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: payload("vendor_invoice", { vendorInvoiceId: alternateVendorInvoiceId }) })).status()).toBe(400);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: payload("vendor_invoice", { vendorInvoiceId: alternateEpisodeInvoiceId }) })).status()).toBe(400);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: payload("vendor_invoice", { vendorInvoiceId: alternateShowInvoiceId }) })).status()).toBe(400);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: payload("budget_line", { budgetLineId: internalBudgetLineId }) })).status()).toBe(409);
  });

  test("enforces one-way PO status transitions while retaining closed-PO actual capture", async ({ page }) => {
    await useSession(page, managerUserId);
    const draft = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-DRAFT-CANCEL" }) });
    const draftId = (await draft.json()).id as string;
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${draftId}`, { data: { status: "cancelled" } })).status()).toBe(200);
    expect((await page.request.patch(`/api/purchase-orders/${draftId}`, { data: { status: "draft" } })).status()).toBe(409);

    const approvedId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-APPROVED-CANCEL" });
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${approvedId}`, { data: { status: "cancelled" } })).status()).toBe(200);
    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${approvedId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 50, allocationDate: "2035-07-03" } })).status()).toBe(409);

    const closedId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-CLOSED-ACTUAL", approvedAmount: 1000 });
    await useSession(page, approverUserId);
    expect((await page.request.patch(`/api/purchase-orders/${closedId}`, { data: { status: "closed" } })).status()).toBe(200);
    expect((await page.request.patch(`/api/purchase-orders/${closedId}`, { data: { status: "approved" } })).status()).toBe(409);
    await useSession(page, managerUserId);
    expect((await page.request.post(`/api/purchase-orders/${closedId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 50, allocationDate: "2035-07-03" } })).status()).toBe(409);
    expect((await page.request.post(`/api/purchase-orders/${closedId}/actual-costs`, { data: { invoiceNumber: "CLOSED-PO-INV", invoiceDate: "2035-07-08", amount: 50, description: "Late supplier invoice" } })).status()).toBe(201);
  });

  test("keeps draft edits tenant-safe and rejects mismatched show and episode scopes", async ({ page }) => {
    await useSession(page, managerUserId);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-DRAFT-SCOPE" }) });
    const purchaseOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { vendorCompanyId: foreignVendorId } })).status()).toBe(404);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { showId: foreignShowId } })).status()).toBe(404);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { episodeId: foreignEpisodeId } })).status()).toBe(404);
    expect((await page.request.patch(`/api/purchase-orders/${purchaseOrderId}`, { data: { showId: alternateShowId, episodeId } })).status()).toBe(400);
  });

  test("requires PO numbers to be unique per tenant but not globally", async ({ page }) => {
    await useSession(page, managerUserId);
    expect((await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-SHARED-NUMBER" }) })).status()).toBe(201);
    expect((await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-SHARED-NUMBER" }) })).status()).toBe(409);
    await useOrganizationSession(page, managerUserId, foreignOrganizationId);
    expect((await page.request.post("/api/purchase-orders", { data: poPayload({ vendorCompanyId: foreignVendorId, showId: foreignShowId, episodeId: foreignEpisodeId, poNumber: "PO-LAB-SHARED-NUMBER" }) })).status()).toBe(201);
  });

  test("requires budget approval before a supplier actual exceeds the authorised PO value", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-ACTUAL-OVERRUN", approvedAmount: 100 });
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/actual-costs`, { data: { invoiceNumber: "OVERRUN-ACTUAL-001", invoiceDate: "2035-07-08", amount: 120, description: "Over-authorised supplier actual" } })).status()).toBe(400);
    const detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ actualInvoicedAmount: 0, varianceAmount: -100 });
  });

  test("removes an existing PO commitment when external work is changed to internal work", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-WO-CHANGE", approvedAmount: 1000 });
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 250, allocationDate: "2035-07-03" } })).status()).toBe(201);
    expect((await page.request.patch(`/api/work-orders/${workOrderId}`, { data: { workType: "internal" } })).status()).toBe(200);
    const allocations = await sql`select id from purchase_order_allocations where organization_id = ${organizationId} and work_order_id = ${workOrderId}`;
    expect(allocations).toHaveLength(0);
    const detail = await (await page.request.get(`/api/purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ committedAmount: 0, remainingAmount: 1000 });
  });

  test("keeps the work-order PO selector tenant-scoped for foreign vendor and episode IDs", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, { poNumber: "PO-LAB-SELECTOR-SCOPE" });
    const foreignVendor = await page.request.get(`/api/purchase-orders?vendorId=${foreignVendorId}&episodeId=${episodeId}`);
    expect(foreignVendor.status()).toBe(200);
    expect(await foreignVendor.json()).toEqual([]);
    const foreignEpisode = await page.request.get(`/api/purchase-orders?vendorId=${vendorId}&episodeId=${foreignEpisodeId}`);
    expect(foreignEpisode.status()).toBe(200);
    expect(await foreignEpisode.json()).toEqual([]);
    const valid = await page.request.get(`/api/purchase-orders?vendorId=${vendorId}&episodeId=${episodeId}`);
    expect((await valid.json()).map((order: { id: string }) => order.id)).toEqual([purchaseOrderId]);
  });

  test("creates a draft and opens its live register detail through the Budget UI", async ({ page }) => {
    await useSession(page, managerUserId);
    await page.goto("/budget/purchase-orders");
    await expect(page.getByRole("heading", { name: "Purchase Orders" })).toBeVisible();
    await page.getByRole("button", { name: "New PO" }).click();
    await page.getByLabel("Vendor").selectOption(vendorId);
    await page.getByLabel("PO number").fill("PO-LAB-UI-001");
    await page.getByLabel("Authorised value (GBP)").fill("825");
    await page.locator('select[name="showId"]').selectOption(showId);
    await page.getByLabel("Notes").fill("UI-created vendor authorisation.");
    await page.getByRole("button", { name: "Create draft PO" }).click();
    await expect(page).toHaveURL(/\/budget\/purchase-orders\//);
    await expect(page.getByRole("heading", { name: "PO-LAB-UI-001" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Allocation ledger" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  });

  test("edits a draft through the register UI", async ({ page }) => {
    await useSession(page, managerUserId);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-UI-EDIT" }) });
    const purchaseOrderId = (await create.json()).id as string;
    await page.goto(`/budget/purchase-orders/${purchaseOrderId}`);
    await page.getByRole("button", { name: "Edit PO" }).click();
    await page.getByLabel("Notes").fill("Updated after supplier quote review.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Updated after supplier quote review.", { exact: true })).toBeVisible();
  });

  test("renders lifecycle controls and supplier-actual entry for an approved PO", async ({ page }) => {
    await useSession(page, managerUserId);
    const create = await page.request.post("/api/purchase-orders", { data: poPayload({ poNumber: "PO-LAB-UI-ACTIONS" }) });
    const purchaseOrderId = (await create.json()).id as string;
    await useSession(page, approverUserId);
    await page.goto(`/budget/purchase-orders/${purchaseOrderId}`);
    await expect(page.getByRole("button", { name: "Approve PO" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Approve PO" }).click();
    await expect(page.getByRole("button", { name: "Close PO" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record supplier actual" })).toBeVisible();
    await page.getByRole("button", { name: "Record supplier actual" }).click();
    await expect(page.getByRole("heading", { name: "Record supplier actual" })).toBeVisible();
    await expect(page.getByLabel("Supplier invoice / reference")).toBeVisible();
  });

  test("renders the allocation ledger, activity, expiry, and over-commitment warnings", async ({ page }) => {
    const purchaseOrderId = await createApprovedPurchaseOrder(page, {
      poNumber: "PO-LAB-UI-WARNINGS",
      approvedAmount: 100,
      issueDate: "2025-01-01",
      expiryDate: "2025-01-02",
    });
    await useSession(page, approverUserId);
    expect((await page.request.post(`/api/purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "work_order", workOrderId, amount: 150, allocationDate: "2035-07-03", reference: "WO-UI-WARN", overrunReason: "Approved final delivery overrun." } })).status()).toBe(201);
    await page.goto(`/budget/purchase-orders/${purchaseOrderId}`);
    const warning = page.locator('section[role="alert"]');
    await expect(warning).toContainText("PO needs attention");
    await expect(warning).toContainText("Committed value exceeds the authorised amount");
    await expect(warning).toContainText("expired");
    await expect(page.getByRole("heading", { name: "Allocation ledger" })).toBeVisible();
    await expect(page.getByText("Work order", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText("PO approved", { exact: true })).toBeVisible();
  });
});
