import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for client purchase-order integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "96000000-0000-4000-8000-000000000001";
const foreignOrganizationId = "96000000-0000-4000-8000-000000000002";
const managerUserId = "user_client_po_manager";
const approverUserId = "user_client_po_approver";
const viewerUserId = "user_client_po_viewer";
const managerPersonId = "96000000-0000-4000-8000-000000000003";
const approverPersonId = "96000000-0000-4000-8000-000000000004";
const viewerPersonId = "96000000-0000-4000-8000-000000000005";
const clientId = "96000000-0000-4000-8000-000000000006";
const foreignClientId = "96000000-0000-4000-8000-000000000007";
const showId = "96000000-0000-4000-8000-000000000008";
const seasonId = "96000000-0000-4000-8000-000000000009";
const episodeId = "96000000-0000-4000-8000-000000000010";
const foreignShowId = "96000000-0000-4000-8000-000000000011";
const foreignSeasonId = "96000000-0000-4000-8000-000000000012";
const foreignEpisodeId = "96000000-0000-4000-8000-000000000013";
const billableId = "96000000-0000-4000-8000-000000000014";
const foreignBillableId = "96000000-0000-4000-8000-000000000015";
const invoiceId = "96000000-0000-4000-8000-000000000016";
const foreignPurchaseOrderId = "96000000-0000-4000-8000-000000000017";
const secondClientId = "96000000-0000-4000-8000-000000000018";
const secondShowId = "96000000-0000-4000-8000-000000000019";
const secondSeasonId = "96000000-0000-4000-8000-000000000020";
const secondEpisodeId = "96000000-0000-4000-8000-000000000021";
const invoiceItemId = "96000000-0000-4000-8000-000000000022";
const legacyMismatchedPurchaseOrderId = "96000000-0000-4000-8000-000000000023";

function clientPoPayload(overrides: Record<string, unknown> = {}) {
  return {
    clientCompanyId: clientId,
    showId,
    episodeId,
    poNumber: "CLIENT-LAB-001",
    approvedAmount: 1000,
    issueDate: "2035-07-01",
    expiryDate: "2035-08-01",
    notes: "Authorised client-funded finishing change.",
    ...overrides,
  };
}

async function setTestSession(page: Page, userId: string) {
  expect((await page.request.post("/api/debug/user", { data: { userId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } })).status()).toBe(200);
}

async function createActiveClientPo(page: Page, overrides: Record<string, unknown> = {}) {
  await setTestSession(page, managerUserId);
  const create = await page.request.post("/api/client-purchase-orders", { data: clientPoPayload(overrides) });
  expect(create.status()).toBe(201);
  const purchaseOrderId = (await create.json()).id as string;
  await setTestSession(page, approverUserId);
  expect((await page.request.patch(`/api/client-purchase-orders/${purchaseOrderId}`, { data: { status: "active" } })).status()).toBe(200);
  await setTestSession(page, managerUserId);
  return purchaseOrderId;
}

test.describe("Client purchase order foundation", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`insert into users (id, name, email) values
      (${managerUserId}, 'Client PO Manager', 'client-po-manager@postpilot.test'),
      (${approverUserId}, 'Client PO Approver', 'client-po-approver@postpilot.test'),
      (${viewerUserId}, 'Client PO Viewer', 'client-po-viewer@postpilot.test')`;
    await sql`insert into organizations (id, name, slug, currency) values
      (${organizationId}, 'Client PO Lab', 'client-po-lab', 'GBP'),
      (${foreignOrganizationId}, 'Foreign Client PO Lab', 'foreign-client-po-lab', 'GBP')`;
    await sql`insert into organization_members (organization_id, user_id, role) values
      (${organizationId}, ${managerUserId}, 'member'),
      (${organizationId}, ${approverUserId}, 'member'),
      (${organizationId}, ${viewerUserId}, 'member')`;
    await sql`insert into organization_role_policies (organization_id, role, label, permissions) values
      (${organizationId}, 'client_po_manager', 'Client PO manager', '["manage_budget"]'::jsonb),
      (${organizationId}, 'client_po_approver', 'Client PO approver', '["manage_budget","approve_budget_overruns"]'::jsonb),
      (${organizationId}, 'client_po_viewer', 'Client PO viewer', '["view_assigned"]'::jsonb)`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values
      (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Client PO Manager', 'client-po-manager@postpilot.test', 'client_po_manager'),
      (${approverPersonId}, ${organizationId}, ${approverUserId}, 'Client PO Approver', 'client-po-approver@postpilot.test', 'client_po_approver'),
      (${viewerPersonId}, ${organizationId}, ${viewerUserId}, 'Client PO Viewer', 'client-po-viewer@postpilot.test', 'client_po_viewer')`;
    await sql`insert into crm_companies (id, organization_id, name, type, currency) values
      (${clientId}, ${organizationId}, 'Client PO Lab Network', 'network', 'GBP'),
      (${secondClientId}, ${organizationId}, 'Second Client PO Lab Network', 'network', 'GBP'),
      (${foreignClientId}, ${foreignOrganizationId}, 'Foreign Client PO Network', 'network', 'GBP')`;
    await sql`insert into shows (id, organization_id, title, code, client_company_id, time_zone) values
      (${showId}, ${organizationId}, 'Client PO Lab Series', 'CPL', ${clientId}, 'Europe/London'),
      (${secondShowId}, ${organizationId}, 'Second Client PO Lab Series', 'CPL2', ${secondClientId}, 'Europe/London'),
      (${foreignShowId}, ${foreignOrganizationId}, 'Foreign Client PO Series', 'FCPL', ${foreignClientId}, 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values
      (${seasonId}, ${organizationId}, ${showId}, 1),
      (${secondSeasonId}, ${organizationId}, ${secondShowId}, 1),
      (${foreignSeasonId}, ${foreignOrganizationId}, ${foreignShowId}, 1)`;
    await sql`insert into episodes (id, organization_id, season_id, number, title, status, qc_status) values
      (${episodeId}, ${organizationId}, ${seasonId}, 1, 'Client PO episode', 'assembly', 'not_started'),
      (${secondEpisodeId}, ${organizationId}, ${secondSeasonId}, 1, 'Second client PO episode', 'assembly', 'not_started'),
      (${foreignEpisodeId}, ${foreignOrganizationId}, ${foreignSeasonId}, 1, 'Foreign client PO episode', 'assembly', 'not_started')`;
    await sql`insert into billables (id, organization_id, show_id, episode_id, vendor, reference, amount, currency, status) values
      (${billableId}, ${organizationId}, ${showId}, ${episodeId}, 'Client change', 'CPL-CO-001', '600.00', 'GBP', 'approved'),
      (${foreignBillableId}, ${foreignOrganizationId}, ${foreignShowId}, ${foreignEpisodeId}, 'Foreign client change', 'FCPL-CO-001', '100.00', 'GBP', 'approved')`;
    await sql`insert into client_invoices (id, organization_id, sequence, invoice_number, client_company_id, show_id, episode_id, status, invoice_date, due_date, currency, subtotal_amount, tax_enabled, tax_name, tax_rate_percent, tax_amount, total_amount, issuer_name, client_name) values
      (${invoiceId}, ${organizationId}, 1, 'CPL-2026-001', ${clientId}, ${showId}, ${episodeId}, 'issued', '2035-07-04', '2035-08-03', 'GBP', '900.00', false, 'VAT', '0', '0', '900.00', 'Client PO Lab', 'Client PO Lab Network')`;
    await sql`insert into client_invoice_items (id, organization_id, client_invoice_id, description, quantity, unit_amount, amount) values
      (${invoiceItemId}, ${organizationId}, ${invoiceId}, 'Client PO invoice line', '1', '900.00', '900.00')`;
    await sql`insert into client_purchase_orders (id, organization_id, client_company_id, show_id, episode_id, po_number, currency, approved_amount, status) values
      (${foreignPurchaseOrderId}, ${foreignOrganizationId}, ${foreignClientId}, ${foreignShowId}, ${foreignEpisodeId}, 'FOREIGN-CLIENT-PO-001', 'GBP', '1000.00', 'active')`;
  });

  test.beforeEach(async () => {
    await sql`delete from client_purchase_order_allocations where organization_id = ${organizationId}`;
    await sql`delete from client_purchase_orders where organization_id = ${organizationId}`;
    await sql`delete from activity_log where organization_id = ${organizationId} and entity_type = 'client_purchase_order'`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    await sql`delete from users where id in (${managerUserId}, ${approverUserId}, ${viewerUserId})`;
    await sql.end();
  });

  test("calculates live balances and gates activation and overruns", async ({ page }) => {
    await setTestSession(page, managerUserId);
    expect((await page.request.post("/api/client-purchase-orders", { data: clientPoPayload({ status: "active" }) })).status()).toBe(403);
    const create = await page.request.post("/api/client-purchase-orders", { data: clientPoPayload() });
    expect(create.status()).toBe(201);
    const purchaseOrderId = (await create.json()).id as string;
    expect((await page.request.patch(`/api/client-purchase-orders/${purchaseOrderId}`, { data: { authorisedAmount: 1 } })).status()).toBe(400);
    expect((await page.request.patch(`/api/client-purchase-orders/${purchaseOrderId}`, { data: { status: "active" } })).status()).toBe(200);

    await setTestSession(page, managerUserId);
    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "billable", billableId, amount: 600, allocationDate: "2035-07-03", reference: "CPL-CO-001" } })).status()).toBe(201);
    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "client_invoice", clientInvoiceId: invoiceId, amount: 900, allocationDate: "2035-07-04", reference: "CPL-2026-001" } })).status()).toBe(201);
    let detail = await (await page.request.get(`/api/client-purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ authorisedAmount: 1000, committedToBillAmount: 600, invoicedAmount: 900, remainingAmount: 400, varianceAmount: -100 });

    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "change_order", changeOrderReference: "CPL-CO-002", amount: 500, allocationDate: "2035-07-05" } })).status()).toBe(400);
    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "change_order", changeOrderReference: "CPL-CO-002", amount: 500, allocationDate: "2035-07-05", overrunReason: "Client approved an additional finishing pass." } })).status()).toBe(201);
    detail = await (await page.request.get(`/api/client-purchase-orders/${purchaseOrderId}`)).json();
    expect(detail).toMatchObject({ committedToBillAmount: 1100, invoicedAmount: 900, remainingAmount: -100, varianceAmount: -100 });
    expect(detail.activity.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(["client_purchase_order.created", "client_purchase_order.activated", "client_purchase_order.allocated", "client_purchase_order.overrun_authorised"]));
    expect(detail.allocations.find((allocation: { changeOrderReference: string | null }) => allocation.changeOrderReference === "CPL-CO-002")).toMatchObject({ overrunAuthorised: true });
  });

  test("scopes reads, writes, and allocation sources to the active tenant", async ({ page }) => {
    await setTestSession(page, managerUserId);
    expect((await page.request.post("/api/client-purchase-orders", { data: clientPoPayload({ clientCompanyId: foreignClientId, poNumber: "CLIENT-LAB-FOREIGN" }) })).status()).toBe(404);
    expect((await page.request.get(`/api/client-purchase-orders/${foreignPurchaseOrderId}`)).status()).toBe(404);

    const create = await page.request.post("/api/client-purchase-orders", { data: clientPoPayload({ poNumber: "CLIENT-LAB-002" }) });
    const purchaseOrderId = (await create.json()).id as string;
    await setTestSession(page, approverUserId);
    expect((await page.request.patch(`/api/client-purchase-orders/${purchaseOrderId}`, { data: { status: "active" } })).status()).toBe(200);
    await setTestSession(page, managerUserId);
    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, { data: { allocationType: "billable", billableId: foreignBillableId, amount: 10, allocationDate: "2035-07-03" } })).status()).toBe(404);
    expect((await page.request.post(`/api/client-purchase-orders/${foreignPurchaseOrderId}/allocations`, { data: { allocationType: "change_order", changeOrderReference: "FOREIGN-CO", amount: 10, allocationDate: "2035-07-03" } })).status()).toBe(404);
    const orders = await (await page.request.get("/api/client-purchase-orders")).json() as Array<{ id: string }>;
    expect(orders.map((order) => order.id)).not.toContain(foreignPurchaseOrderId);
  });

  test("keeps client PO reads and mutations behind Budget capabilities", async ({ page }) => {
    await setTestSession(page, viewerUserId);
    expect((await page.request.get("/api/client-purchase-orders")).status()).toBe(403);
    expect((await page.request.post("/api/client-purchase-orders", { data: clientPoPayload({ poNumber: "CLIENT-LAB-003" }) })).status()).toBe(403);
  });

  test("does not allow the same billable to consume two client POs", async ({ page }) => {
    const firstPurchaseOrderId = await createActiveClientPo(page, { poNumber: "CLIENT-LAB-DUP-A" });
    const secondPurchaseOrderId = await createActiveClientPo(page, { poNumber: "CLIENT-LAB-DUP-B" });
    const allocation = { allocationType: "billable", billableId, amount: 600, allocationDate: "2035-07-03", reference: "CPL-CO-001" };

    expect((await page.request.post(`/api/client-purchase-orders/${firstPurchaseOrderId}/allocations`, { data: allocation })).status()).toBe(201);
    expect((await page.request.post(`/api/client-purchase-orders/${secondPurchaseOrderId}/allocations`, { data: allocation })).status()).toBe(409);
  });

  test("does not double count an invoice header and one of its lines", async ({ page }) => {
    const purchaseOrderId = await createActiveClientPo(page, { poNumber: "CLIENT-LAB-INVOICE-SOURCE" });
    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, {
      data: { allocationType: "client_invoice", clientInvoiceId: invoiceId, amount: 900, allocationDate: "2035-07-04", reference: "CPL-2026-001" },
    })).status()).toBe(201);

    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, {
      data: { allocationType: "client_invoice", clientInvoiceItemId: invoiceItemId, amount: 100, allocationDate: "2035-07-04", reference: "CPL-2026-001-L1" },
    })).status()).toBe(409);
  });

  test("requires a client PO's client to match its selected show", async ({ page }) => {
    await setTestSession(page, managerUserId);
    const response = await page.request.post("/api/client-purchase-orders", {
      data: clientPoPayload({ clientCompanyId: secondClientId, poNumber: "CLIENT-LAB-WRONG-CLIENT" }),
    });
    expect(response.status()).toBe(400);
  });

  test("rejects an allocation to legacy client PO data with a mismatched show client", async ({ page }) => {
    await sql`insert into client_purchase_orders (id, organization_id, client_company_id, show_id, episode_id, po_number, currency, approved_amount, status)
      values (${legacyMismatchedPurchaseOrderId}, ${organizationId}, ${secondClientId}, ${showId}, ${episodeId}, 'CLIENT-LAB-LEGACY-MISMATCH', 'GBP', '1000.00', 'active')`;
    await setTestSession(page, managerUserId);
    const response = await page.request.post(`/api/client-purchase-orders/${legacyMismatchedPurchaseOrderId}/allocations`, {
      data: { allocationType: "billable", billableId, amount: 600, allocationDate: "2035-07-03", reference: "CPL-CO-001" },
    });
    expect(response.status()).toBe(400);
  });

  test("recalculates a PO's commitment when a billable is voided", async ({ page }) => {
    const purchaseOrderId = await createActiveClientPo(page, { poNumber: "CLIENT-LAB-VOID-RECONCILE" });
    expect((await page.request.post(`/api/client-purchase-orders/${purchaseOrderId}/allocations`, {
      data: { allocationType: "billable", billableId, amount: 600, allocationDate: "2035-07-03", reference: "CPL-CO-001" },
    })).status()).toBe(201);
    expect((await (await page.request.get(`/api/client-purchase-orders/${purchaseOrderId}`)).json()).committedToBillAmount).toBe(600);

    await sql`update billables set status = 'void' where id = ${billableId}`;
    expect((await (await page.request.get(`/api/client-purchase-orders/${purchaseOrderId}`)).json()).committedToBillAmount).toBe(0);
    await sql`update billables set status = 'approved' where id = ${billableId}`;
  });

  test("keeps cancelled and closed client POs terminal and non-allocatable", async ({ page }) => {
    await setTestSession(page, managerUserId);
    const draft = await page.request.post("/api/client-purchase-orders", { data: clientPoPayload({ poNumber: "CLIENT-LAB-CANCELLED" }) });
    const cancelledPurchaseOrderId = (await draft.json()).id as string;
    await setTestSession(page, approverUserId);
    expect((await page.request.patch(`/api/client-purchase-orders/${cancelledPurchaseOrderId}`, { data: { status: "cancelled" } })).status()).toBe(200);
    expect((await page.request.patch(`/api/client-purchase-orders/${cancelledPurchaseOrderId}`, { data: { status: "active" } })).status()).toBe(409);

    const closedPurchaseOrderId = await createActiveClientPo(page, { poNumber: "CLIENT-LAB-CLOSED" });
    await setTestSession(page, approverUserId);
    expect((await page.request.patch(`/api/client-purchase-orders/${closedPurchaseOrderId}`, { data: { status: "closed" } })).status()).toBe(200);
    await setTestSession(page, managerUserId);
    expect((await page.request.post(`/api/client-purchase-orders/${closedPurchaseOrderId}/allocations`, {
      data: { allocationType: "change_order", changeOrderReference: "CPL-CLOSED-CO", amount: 50, allocationDate: "2035-07-05" },
    })).status()).toBe(409);
  });
});
