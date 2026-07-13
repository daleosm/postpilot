import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodes, people } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { episodeTeamAssignmentSchema } from "@/lib/validations/entities";

export async function GET(_request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { episodeId } = await params;
  const db = getDb();
  const organizationId = context.organization.organizationId;
  const [episode, assignments, organizationPeople] = await Promise.all([
    db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId))).limit(1),
    db.select({ id: episodeTeamAssignments.id, personId: people.id, name: people.name, role: people.role, responsibility: episodeTeamAssignments.responsibility, isLead: episodeTeamAssignments.isLead }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, organizationId))),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.organizationId, organizationId)),
  ]);
  if (!episode[0]) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  return NextResponse.json({ assignments, people: organizationPeople });
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = episodeTeamAssignmentSchema.pick({ personId: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the assignment." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { episodeId } = await params; const db = getDb(); const org = context.organization.organizationId;
  const [episode, person] = await Promise.all([
    db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, org))).limit(1),
    db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.id, parsed.data.personId), eq(people.organizationId, org))).limit(1),
  ]);
  if (!episode[0] || !person[0]) return NextResponse.json({ error: "Episode or person not found." }, { status: 404 });
  const [assignment] = await db.insert(episodeTeamAssignments).values({ ...parsed.data, responsibility: person[0].role, organizationId: org, episodeId }).onConflictDoNothing().returning({ id: episodeTeamAssignments.id });
  return NextResponse.json(assignment ?? { duplicate: true }, { status: assignment ? 201 : 200 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("assignmentId"); if (!id) return NextResponse.json({ error: "Assignment is required." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { episodeId } = await params; const result = await getDb().delete(episodeTeamAssignments).where(and(eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.episodeId, episodeId), eq(episodeTeamAssignments.organizationId, context.organization.organizationId))).returning({ id: episodeTeamAssignments.id });
  return result.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Assignment not found." }, { status: 404 });
}
