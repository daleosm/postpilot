import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { crmCompanies, crmContacts } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { insertCrmContactSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_shows")) && !(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertCrmContactSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the contact details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const [company] = await getDb().select({ id: crmCompanies.id }).from(crmCompanies).where(and(eq(crmCompanies.id, parsed.data.companyId), eq(crmCompanies.organizationId, organizationId))).limit(1);
  if (!company) return NextResponse.json({ error: "Account not found for this post house." }, { status: 404 });
  const [contact] = await getDb().insert(crmContacts).values({ ...parsed.data, organizationId, title: parsed.data.title || null, email: parsed.data.email || null, phone: parsed.data.phone || null, notes: parsed.data.notes || null }).returning({ id: crmContacts.id });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "crm_contact.created", entityType: "crm_contact", entityId: contact.id, metadata: { companyId: company.id, name: parsed.data.name, contactType: parsed.data.contactType } });
  return NextResponse.json(contact, { status: 201 });
}
