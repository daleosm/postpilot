import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { cateringSettings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const schema = z.object({ markupPercent: z.coerce.number().min(0).max(100).finite() });

export async function PATCH(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a markup between 0% and 100%." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb(); const organizationId = context.organization.organizationId;
  await db.insert(cateringSettings).values({ organizationId, markupPercent: String(parsed.data.markupPercent) }).onConflictDoUpdate({ target: cateringSettings.organizationId, set: { markupPercent: String(parsed.data.markupPercent), updatedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
