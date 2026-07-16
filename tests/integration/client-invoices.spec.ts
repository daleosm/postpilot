import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for client invoice integration tests.");
const sql = postgres(databaseUrl, { prepare: false });

const organizationId = "99000000-0000-4000-8000-000000000001";
const managerUserId = "user_client_invoice_manager";
const managerPersonId = "99000000-0000-4000-8000-000000000002";
const companyId = "99000000-0000-4000-8000-000000000003";
const showId = "99000000-0000-4000-8000-000000000004";
const seasonId = "99000000-0000-4000-8000-000000000005";
const workflowId = "99000000-0000-4000-8000-000000000006";
const activeStageId = "99000000-0000-4000-8000-000000000007";
const terminalStageId = "99000000-0000-4000-8000-000000000008";
const episodeId = "99000000-0000-4000-8000-000000000009";
const bookingId = "99000000-0000-4000-8000-000000000010";
const billableId = "99000000-0000-4000-8000-000000000011";

async function useSession(page: Page) {
  expect((await page.request.post("/api/debug/user", { data: { userId: managerUserId } })).status()).toBe(200);
  expect((await page.request.post("/api/organizations/active", { data: { organizationId, pathname: "/budget" } })).status()).toBe(200);
}

test.describe("Client invoice issuance", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`insert into users (id, name, email) values (${managerUserId}, 'Invoice Lab Manager', 'invoice-lab-manager@postpilot.test') on conflict (id) do update set name = excluded.name, email = excluded.email`;
    await sql`insert into organizations (id, name, slug, currency) values (${organizationId}, 'Invoice Lab', 'invoice-lab', 'GBP')`;
    await sql`insert into organization_members (organization_id, user_id, role) values (${organizationId}, ${managerUserId}, 'admin')`;
    await sql`insert into people (id, organization_id, user_id, name, email, role) values (${managerPersonId}, ${organizationId}, ${managerUserId}, 'Invoice Lab Manager', 'invoice-lab-manager@postpilot.test', 'producer')`;
    await sql`insert into crm_companies (id, organization_id, name, type, address, finance_email, payment_terms_days) values (${companyId}, ${organizationId}, 'Invoice Client', 'client', '1 Studio Way, London', 'accounts@invoice-client.test', 14)`;
    await sql`insert into shows (id, organization_id, title, code, client_company_id, time_zone) values (${showId}, ${organizationId}, 'Invoice Series', 'INV', ${companyId}, 'Europe/London')`;
    await sql`insert into seasons (id, organization_id, show_id, number) values (${seasonId}, ${organizationId}, ${showId}, 1)`;
    await sql`insert into post_workflows (id, organization_id, name, is_default) values (${workflowId}, ${organizationId}, 'Invoice workflow', true)`;
    await sql`insert into invoice_settings (organization_id, legal_name, legal_address, billing_email, tax_name, tax_rate_percent, payment_terms_days, payment_instructions) values (${organizationId}, 'Invoice Lab Limited', '1 Billing Lane, London', 'accounts@invoice-lab.test', 'VAT', '0', 30, 'Pay by bank transfer.')`;
    await sql`insert into workflow_stages (id, organization_id, workflow_id, name, key, position, is_terminal) values (${activeStageId}, ${organizationId}, ${workflowId}, 'Online', 'online', 1, false), (${terminalStageId}, ${organizationId}, ${workflowId}, 'Archive', 'archive', 2, true)`;
    await sql`insert into episodes (id, organization_id, season_id, workflow_stage_id, number, production_code, title, status, qc_status) values (${episodeId}, ${organizationId}, ${seasonId}, ${activeStageId}, 1, 'INV101', 'Invoice episode', 'online', 'passed')`;
    await sql`insert into bookings (id, organization_id, episode_id, person_id, title, starts_at, ends_at, status, booking_type) values (${bookingId}, ${organizationId}, ${episodeId}, ${managerPersonId}, 'Invoice finishing day', '2035-08-01T09:00:00.000Z', '2035-08-01T18:00:00.000Z', 'confirmed', 'edit')`;
    await sql`insert into billables (id, organization_id, show_id, episode_id, vendor, reference, description, amount, currency, status) values (${billableId}, ${organizationId}, ${showId}, ${episodeId}, 'Client change', 'CO-12', 'Approved editorial change', '1250.00', 'GBP', 'approved')`;
  });

  test.afterAll(async () => {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql`delete from users where id = ${managerUserId}`;
    await sql.end();
  });

  test("requires terminal workflow and submitted actual time before issuing or exporting a PDF", async ({ page }) => {
    await useSession(page);
    await sql`delete from invoice_settings where organization_id = ${organizationId}`;
    const profileBlocked = await page.request.post("/api/client-invoices", { data: { episodeId } });
    expect(profileBlocked.status()).toBe(409);
    expect((await profileBlocked.json()).error).toContain("Complete the invoicing profile");
    await sql`insert into invoice_settings (organization_id, legal_name, legal_address, billing_email, tax_name, tax_rate_percent, payment_terms_days, payment_instructions) values (${organizationId}, 'Invoice Lab Limited', '1 Billing Lane, London', 'accounts@invoice-lab.test', 'VAT', '0', 30, 'Pay by bank transfer.')`;

    await sql`update shows set client_company_id = null where id = ${showId}`;
    const clientBlocked = await page.request.post("/api/client-invoices", { data: { episodeId } });
    expect(clientBlocked.status()).toBe(409);
    expect((await clientBlocked.json()).error).toContain("Assign a client");
    await sql`update shows set client_company_id = ${companyId} where id = ${showId}`;

    const workflowBlocked = await page.request.post("/api/client-invoices", { data: { episodeId } });
    expect(workflowBlocked.status()).toBe(409);
    expect((await workflowBlocked.json()).error).toContain("Complete the episode workflow");

    await sql`update episodes set workflow_stage_id = ${terminalStageId} where id = ${episodeId}`;
    const timeBlocked = await page.request.post("/api/client-invoices", { data: { episodeId } });
    expect(timeBlocked.status()).toBe(409);
    expect((await timeBlocked.json()).error).toContain("actual time confirmed");

    const actuals = await page.request.post(`/api/bookings/${bookingId}/time-submissions`, { data: { actualStartsAt: "2035-08-01T09:00:00.000Z", actualEndsAt: "2035-08-01T18:00:00.000Z", overtimeMinutes: 0 } });
    expect(actuals.status()).toBe(201);

    const issueResponses = await Promise.all([
      page.request.post("/api/client-invoices", { data: { episodeId } }),
      page.request.post("/api/client-invoices", { data: { episodeId } }),
    ]);
    expect(issueResponses.map((response) => response.status()).sort()).toEqual([201, 409]);
    const issued = issueResponses.find((response) => response.status() === 201);
    if (!issued) throw new Error("Expected exactly one invoice issue request to succeed.");
    const invoice = await issued.json() as { id: string; invoiceNumber: string };
    expect(invoice.invoiceNumber).toMatch(/^INVOICELAB-2035|^INVOICELAB-20/);
    const [stored] = await sql`select status, subtotal_amount, total_amount, client_name from client_invoices where id = ${invoice.id}`;
    expect(stored).toMatchObject({ status: "issued", subtotal_amount: "1250.00", total_amount: "1250.00", client_name: "Invoice Client" });
    const [billable] = await sql`select status, client_invoice_id from billables where id = ${billableId}`;
    expect(billable).toMatchObject({ status: "invoiced", client_invoice_id: invoice.id });
    const [{ count: invoiceCount }] = await sql`select count(*)::int as count from client_invoices where organization_id = ${organizationId}`;
    expect(invoiceCount).toBe(1);

    await sql`update crm_companies set name = 'Changed client', address = 'Changed address' where id = ${companyId}`;
    await sql`update invoice_settings set legal_name = 'Changed issuer', legal_address = 'Changed issuer address' where organization_id = ${organizationId}`;
    const [snapshot] = await sql`select issuer_name, issuer_address, client_name, client_address from client_invoices where id = ${invoice.id}`;
    expect(snapshot).toMatchObject({ issuer_name: "Invoice Lab Limited", issuer_address: "1 Billing Lane, London", client_name: "Invoice Client", client_address: "1 Studio Way, London" });

    const pdf = await page.request.get(`/api/client-invoices/${invoice.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).subarray(0, 8).toString()).toBe("%PDF-1.4");

    await sql`update episodes set workflow_stage_id = ${activeStageId} where id = ${episodeId}`;
    expect((await page.request.get(`/api/client-invoices/${invoice.id}/pdf`)).status()).toBe(409);
    await sql`update episodes set workflow_stage_id = ${terminalStageId} where id = ${episodeId}`;
    await sql`update client_invoices set status = 'void' where id = ${invoice.id}`;
    expect((await page.request.get(`/api/client-invoices/${invoice.id}/pdf`)).status()).toBe(409);
  });
});
