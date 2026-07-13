import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { crmCompanies } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { insertCrmCompanySchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_shows")) && !(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertCrmCompanySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the account details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [company] = await getDb().insert(crmCompanies).values({ ...parsed.data, organizationId: context.organization.organizationId }).returning({ id: crmCompanies.id });
    await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "crm_company.created", entityType: "crm_company", entityId: company.id, metadata: { name: parsed.data.name, type: parsed.data.type } });
    return NextResponse.json(company, { status: 201 });
  } catch {
    return NextResponse.json({ error: "An account with this name already exists for this post house." }, { status: 409 });
  }
}
