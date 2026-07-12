import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { people, showTeamAssignments, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { showFormSchema } from "@/lib/validations/entities";
import { and, eq, inArray } from "drizzle-orm";

export async function POST(request: Request) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = showFormSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the show details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-show", debug: true }, { status: 201 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { teamMemberIds, ...showData } = parsed.data;
  const db = getDb();
  if (teamMemberIds.length) {
    const team = await db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, organizationId), inArray(people.id, teamMemberIds)));
    if (team.length !== teamMemberIds.length) return NextResponse.json({ error: "One or more selected team members are not in this organization." }, { status: 400 });
  }
  const show = await db.transaction(async (tx) => {
    const [created] = await tx.insert(shows).values({ ...showData, organizationId }).returning({ id: shows.id });
    if (teamMemberIds.length) await tx.insert(showTeamAssignments).values(teamMemberIds.map((personId) => ({ organizationId, showId: created.id, personId })));
    return created;
  });
  return NextResponse.json(show, { status: 201 });
}
