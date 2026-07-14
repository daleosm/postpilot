import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { billables, budgetLines, cateringRequests, crmCompanies, organizations, postWorkOrders, rateCards, serviceRates, vendorInvoices } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const schema = z.object({ currency: z.enum(["GBP", "USD", "EUR", "CAD", "AUD"]) });

export async function PATCH(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a supported reporting currency." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(organizations.id, organizationId));
    await Promise.all([
      tx.update(crmCompanies).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(crmCompanies.organizationId, organizationId)),
      tx.update(postWorkOrders).set({ currency: parsed.data.currency, clientQuoteCurrency: parsed.data.currency, updatedAt: new Date() }).where(eq(postWorkOrders.organizationId, organizationId)),
      tx.update(budgetLines).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(budgetLines.organizationId, organizationId)),
      tx.update(serviceRates).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(serviceRates.organizationId, organizationId)),
      tx.update(rateCards).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(rateCards.organizationId, organizationId)),
      tx.update(billables).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(billables.organizationId, organizationId)),
      tx.update(vendorInvoices).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(vendorInvoices.organizationId, organizationId)),
      tx.update(cateringRequests).set({ currency: parsed.data.currency, updatedAt: new Date() }).where(eq(cateringRequests.organizationId, organizationId)),
    ]);
  });
  return NextResponse.json({ ok: true, currency: parsed.data.currency });
}
