import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodeWorkflowApprovals, episodes, people } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageEpisodes, isAssignedToEpisode } from "@/lib/permissions";
import { episodeTeamAssignmentSchema } from "@/lib/validations/entities";

const signerSchema = z.object({ assignmentId: z.string().uuid(), isSigner: z.boolean() });

export async function GET(_request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { episodeId } = await params;
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const db = getDb();
  const organizationId = context.organization.organizationId;
  const [episode, assignments, organizationPeople] = await Promise.all([
    db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId))).limit(1),
    db.select({ id: episodeTeamAssignments.id, personId: people.id, name: people.name, role: people.role, isLead: episodeTeamAssignments.isLead }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, organizationId))),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.organizationId, organizationId)),
  ]);
  if (!episode[0]) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  return NextResponse.json({ assignments, people: organizationPeople });
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = episodeTeamAssignmentSchema.pick({ personId: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the assignment." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { episodeId } = await params; if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 }); const db = getDb(); const org = context.organization.organizationId;
  const [episode, person] = await Promise.all([
    db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, org))).limit(1),
    db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.id, parsed.data.personId), eq(people.organizationId, org))).limit(1),
  ]);
  if (!episode[0] || !person[0]) return NextResponse.json({ error: "Episode or person not found." }, { status: 404 });
  const [assignment] = await db.insert(episodeTeamAssignments).values({ ...parsed.data, isLead: false, organizationId: org, episodeId }).onConflictDoNothing().returning({ id: episodeTeamAssignments.id });
  return NextResponse.json(assignment ?? { duplicate: true }, { status: assignment ? 201 : 200 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = signerSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose an episode-team signer." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { episodeId } = await params;
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const org = context.organization.organizationId;
  const db = getDb();
  const team = await db.select({ id: episodeTeamAssignments.id, personId: people.id, role: people.role }).from(episodeTeamAssignments)
    .innerJoin(people, eq(episodeTeamAssignments.personId, people.id))
    .where(and(eq(episodeTeamAssignments.organizationId, org), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, org)));
  const selected = team.find((assignment) => assignment.id === parsed.data.assignmentId);
  if (!selected) return NextResponse.json({ error: "Episode-team assignment not found." }, { status: 404 });
  const sameRoleIds = team.filter((assignment) => assignment.role === selected.role).map((assignment) => assignment.id);
  await db.transaction(async (tx) => {
    await tx.update(episodeTeamAssignments).set({ isLead: false, updatedAt: new Date() }).where(and(eq(episodeTeamAssignments.organizationId, org), inArray(episodeTeamAssignments.id, sameRoleIds)));
    if (parsed.data.isSigner) await tx.update(episodeTeamAssignments).set({ isLead: true, updatedAt: new Date() }).where(and(eq(episodeTeamAssignments.organizationId, org), eq(episodeTeamAssignments.id, selected.id)));
    await tx.update(episodeWorkflowApprovals).set({ requiredPersonId: parsed.data.isSigner ? selected.personId : null, updatedAt: new Date() }).where(and(eq(episodeWorkflowApprovals.organizationId, org), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.approverRole, selected.role), eq(episodeWorkflowApprovals.status, "pending")));
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("assignmentId"); if (!id) return NextResponse.json({ error: "Assignment is required." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { episodeId } = await params;
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const org = context.organization.organizationId;
  const db = getDb();
  const [removed] = await db.select({ id: episodeTeamAssignments.id }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.episodeId, episodeId), eq(episodeTeamAssignments.organizationId, org), eq(people.organizationId, org))).limit(1);
  if (!removed) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  const [pendingSignOff] = await db.select({ id: episodeWorkflowApprovals.id }).from(episodeWorkflowApprovals)
    .innerJoin(episodeTeamAssignments, eq(episodeWorkflowApprovals.requiredPersonId, episodeTeamAssignments.personId))
    .where(and(eq(episodeWorkflowApprovals.organizationId, org), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.status, "pending"), eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.organizationId, org)))
    .limit(1);
  if (pendingSignOff) return NextResponse.json({ error: "Choose a replacement workflow signer or complete the pending sign-off before removing this person." }, { status: 409 });
  await db.delete(episodeTeamAssignments).where(and(eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.episodeId, episodeId), eq(episodeTeamAssignments.organizationId, org)));
  return NextResponse.json({ ok: true });
}
