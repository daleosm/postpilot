import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { crmCompanies } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { updateCrmCompanySchema } from "@/lib/validations/entities";

/** Updates only internal account-management information for the active post house. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  if (!(await can("manage_shows")) && !(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateCrmCompanySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the account details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { companyId } = await params;
  const organizationId = context.organization.organizationId;
  const missing = await missingTenantReferences(organizationId, { personId: parsed.data.accountOwnerId ?? null });
  if (missing.length) return NextResponse.json({ error: "Choose an account owner from this post house." }, { status: 404 });
  const db = getDb();
  const [company] = await db.select({ id: crmCompanies.id }).from(crmCompanies).where(and(eq(crmCompanies.id, companyId), eq(crmCompanies.organizationId, organizationId))).limit(1);
  if (!company) return NextResponse.json({ error: "Account not found for this post house." }, { status: 404 });
  await db.update(crmCompanies).set({ ...parsed.data, accountOwnerId: parsed.data.accountOwnerId ?? null, nextAction: parsed.data.nextAction || null, nextActionDueAt: parsed.data.nextActionDueAt ?? null, notes: parsed.data.notes || null, updatedAt: new Date() }).where(and(eq(crmCompanies.id, companyId), eq(crmCompanies.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "crm_company.updated", entityType: "crm_company", entityId: companyId, metadata: { fields: Object.keys(parsed.data) } });
  return NextResponse.json({ id: companyId });
}
