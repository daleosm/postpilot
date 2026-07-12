import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { people, showTeamAssignments, shows } from "@/lib/db/schema";
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
  const { teamMemberIds, ...showData } = parsed.data;
  const db = getDb();
  if (teamMemberIds) {
    const team = teamMemberIds.length ? await db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, organizationId), inArray(people.id, teamMemberIds))) : [];
    if (team.length !== teamMemberIds.length) return NextResponse.json({ error: "One or more selected team members are not in this organization." }, { status: 400 });
  }
  const show = await db.transaction(async (tx) => {
    const [updated] = await tx.update(shows).set({ ...showData, updatedAt: new Date() })
      .where(and(eq(shows.id, showId), eq(shows.organizationId, organizationId))).returning({ id: shows.id });
    if (!updated) return null;
    if (teamMemberIds) {
      await tx.delete(showTeamAssignments).where(eq(showTeamAssignments.showId, showId));
      if (teamMemberIds.length) await tx.insert(showTeamAssignments).values(teamMemberIds.map((personId) => ({ organizationId, showId, personId })));
    }
    return updated;
  });
  if (!show) return NextResponse.json({ error: "Show not found." }, { status: 404 });
  return NextResponse.json(show);
}
