import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { serviceRates } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { updateServiceRateSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ rateId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateServiceRateSchema.safeParse(await request.json());
  if (!parsed.success || !Object.keys(parsed.data).length) return NextResponse.json({ error: "Check the service rate details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debug: true });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rateId } = await params;
  try {
    const [rate] = await getDb().update(serviceRates).set({ ...parsed.data, rate: parsed.data.rate === undefined ? undefined : String(parsed.data.rate), updatedAt: new Date() })
      .where(and(eq(serviceRates.id, rateId), eq(serviceRates.organizationId, context.organization.organizationId))).returning({ id: serviceRates.id });
    if (!rate) return NextResponse.json({ error: "Service rate not found." }, { status: 404 });
    return NextResponse.json(rate);
  } catch {
    return NextResponse.json({ error: "A service with that name already exists in this post house." }, { status: 409 });
  }
}
