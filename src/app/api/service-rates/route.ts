import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { serviceRates } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { insertServiceRateSchema } from "@/lib/validations/entities";

const requestSchema = insertServiceRateSchema.omit({ organizationId: true });

export async function POST(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the service rate details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-service-rate", debug: true }, { status: 201 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [rate] = await getDb().insert(serviceRates).values({ ...parsed.data, organizationId: context.organization.organizationId, currency: context.organization.currency, rate: String(parsed.data.rate) }).returning({ id: serviceRates.id });
    return NextResponse.json(rate, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A service with that name already exists in this post house." }, { status: 409 });
  }
}
