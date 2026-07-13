import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { showFormSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ showId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = showFormSchema.partial().safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the show details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debug: true });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { showId } = await params;
  const db = getDb();
  const [show] = await db.update(shows).set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(shows.id, showId), eq(shows.organizationId, organizationId))).returning({ id: shows.id });
  if (!show) return NextResponse.json({ error: "Show not found." }, { status: 404 });
  return NextResponse.json(show);
}
