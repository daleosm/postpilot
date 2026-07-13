import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { showFormSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = showFormSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the show details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-show", debug: true }, { status: 201 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [show] = await db.insert(shows).values({ ...parsed.data, organizationId }).returning({ id: shows.id });
  return NextResponse.json(show, { status: 201 });
}
