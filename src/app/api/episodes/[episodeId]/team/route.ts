import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodeWorkflowApprovals, episodeWorkflowSigners, episodes, people, postWorkflows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageEpisodes, isAssignedToEpisode } from "@/lib/permissions";
import { episodeTeamAssignmentSchema } from "@/lib/validations/entities";

const signerSchema = z.object({ assignmentId: z.string().uuid(), isSigner: z.boolean() });
const signOffSlotSchema = z.object({ approvalRuleId: z.string().uuid(), personId: z.string().uuid().nullable() });

export async function GET(_request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { episodeId } = await params;
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const db = getDb();
  const organizationId = context.organization.organizationId;
  const [episode, assignments, organizationPeople, signOffSlots] = await Promise.all([
    db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId))).limit(1),
    db.select({ id: episodeTeamAssignments.id, personId: people.id, name: people.name, role: people.role, isLead: episodeTeamAssignments.isLead }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, organizationId))),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.organizationId, organizationId)),
    db.select({ approvalRuleId: workflowStageApprovalRules.id, stageName: workflowStages.name, label: workflowStageApprovalRules.label, isRequired: workflowStageApprovalRules.isRequired, personId: episodeWorkflowSigners.personId })
      .from(workflowStageApprovalRules).innerJoin(workflowStages, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id)).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .leftJoin(episodeWorkflowSigners, and(eq(episodeWorkflowSigners.workflowStageApprovalRuleId, workflowStageApprovalRules.id), eq(episodeWorkflowSigners.episodeId, episodeId), eq(episodeWorkflowSigners.organizationId, organizationId)))
      .where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(postWorkflows.organizationId, organizationId), eq(postWorkflows.isDefault, true)))
      .orderBy(workflowStages.position, workflowStageApprovalRules.approvalOrder),
  ]);
  if (!episode[0]) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  return NextResponse.json({ assignments, people: organizationPeople, signOffSlots });
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
  const payload = await request.json();
  const slot = signOffSlotSchema.safeParse(payload);
  const legacy = signerSchema.safeParse(payload);
  if (!slot.success && !legacy.success) return NextResponse.json({ error: "Choose a named person for this sign-off slot." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { episodeId } = await params;
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const org = context.organization.organizationId;
  const db = getDb();
  if (slot.success) {
    const [rule] = await db.select({ id: workflowStageApprovalRules.id }).from(workflowStageApprovalRules)
      .innerJoin(workflowStages, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id))
      .innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(eq(workflowStageApprovalRules.id, slot.data.approvalRuleId), eq(workflowStageApprovalRules.organizationId, org), eq(workflowStages.organizationId, org), eq(postWorkflows.organizationId, org), eq(postWorkflows.isDefault, true))).limit(1);
    if (!rule) return NextResponse.json({ error: "Sign-off slot not found." }, { status: 404 });
    if (slot.data.personId) {
      const [teamMember] = await db.select({ personId: episodeTeamAssignments.personId }).from(episodeTeamAssignments)
        .innerJoin(people, eq(episodeTeamAssignments.personId, people.id))
        .where(and(eq(episodeTeamAssignments.organizationId, org), eq(episodeTeamAssignments.episodeId, episodeId), eq(episodeTeamAssignments.personId, slot.data.personId), eq(people.organizationId, org))).limit(1);
      if (!teamMember) return NextResponse.json({ error: "Add this person to the episode team before assigning the sign-off slot." }, { status: 409 });
    }
    await db.transaction(async (tx) => {
      if (slot.data.personId) await tx.insert(episodeWorkflowSigners).values({ organizationId: org, episodeId, workflowStageApprovalRuleId: rule.id, personId: slot.data.personId }).onConflictDoUpdate({ target: [episodeWorkflowSigners.episodeId, episodeWorkflowSigners.workflowStageApprovalRuleId], set: { personId: slot.data.personId, updatedAt: new Date() } });
      else await tx.delete(episodeWorkflowSigners).where(and(eq(episodeWorkflowSigners.organizationId, org), eq(episodeWorkflowSigners.episodeId, episodeId), eq(episodeWorkflowSigners.workflowStageApprovalRuleId, rule.id)));
      await tx.update(episodeWorkflowApprovals).set({ requiredPersonId: slot.data.personId, updatedAt: new Date() }).where(and(eq(episodeWorkflowApprovals.organizationId, org), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.approvalRuleId, rule.id), eq(episodeWorkflowApprovals.status, "pending")));
    });
    return NextResponse.json({ ok: true });
  }
  const parsed = legacy;
  if (!parsed.success) return NextResponse.json({ error: "Choose an episode-team signer." }, { status: 400 });
  const team = await db.select({ id: episodeTeamAssignments.id, personId: people.id, role: people.role }).from(episodeTeamAssignments)
    .innerJoin(people, eq(episodeTeamAssignments.personId, people.id))
    .where(and(eq(episodeTeamAssignments.organizationId, org), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, org)));
  const selected = team.find((assignment) => assignment.id === parsed.data.assignmentId);
  if (!selected) return NextResponse.json({ error: "Episode-team assignment not found." }, { status: 404 });
  const sameRoleIds = team.filter((assignment) => assignment.role === selected.role).map((assignment) => assignment.id);
  const legacyRuleIds = await db.select({ id: workflowStageApprovalRules.id }).from(workflowStageApprovalRules)
    .where(and(eq(workflowStageApprovalRules.organizationId, org), eq(workflowStageApprovalRules.approverRole, selected.role)));
  await db.transaction(async (tx) => {
    await tx.update(episodeTeamAssignments).set({ isLead: false, updatedAt: new Date() }).where(and(eq(episodeTeamAssignments.organizationId, org), inArray(episodeTeamAssignments.id, sameRoleIds)));
    if (parsed.data.isSigner) await tx.update(episodeTeamAssignments).set({ isLead: true, updatedAt: new Date() }).where(and(eq(episodeTeamAssignments.organizationId, org), eq(episodeTeamAssignments.id, selected.id)));
    if (parsed.data.isSigner && legacyRuleIds.length) await tx.insert(episodeWorkflowSigners).values(legacyRuleIds.map((rule) => ({ organizationId: org, episodeId, workflowStageApprovalRuleId: rule.id, personId: selected.personId }))).onConflictDoUpdate({ target: [episodeWorkflowSigners.episodeId, episodeWorkflowSigners.workflowStageApprovalRuleId], set: { personId: selected.personId, updatedAt: new Date() } });
    if (!parsed.data.isSigner && legacyRuleIds.length) await tx.delete(episodeWorkflowSigners).where(and(eq(episodeWorkflowSigners.organizationId, org), eq(episodeWorkflowSigners.episodeId, episodeId), inArray(episodeWorkflowSigners.workflowStageApprovalRuleId, legacyRuleIds.map((rule) => rule.id)), eq(episodeWorkflowSigners.personId, selected.personId)));
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
  const [removed] = await db.select({ id: episodeTeamAssignments.id, personId: episodeTeamAssignments.personId }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.episodeId, episodeId), eq(episodeTeamAssignments.organizationId, org), eq(people.organizationId, org))).limit(1);
  if (!removed) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  const [pendingSignOff, configuredSignOff] = await Promise.all([
    db.select({ id: episodeWorkflowApprovals.id }).from(episodeWorkflowApprovals)
    .innerJoin(episodeTeamAssignments, eq(episodeWorkflowApprovals.requiredPersonId, episodeTeamAssignments.personId))
    .where(and(eq(episodeWorkflowApprovals.organizationId, org), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.status, "pending"), eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.organizationId, org)))
    .limit(1),
    db.select({ id: episodeWorkflowSigners.id }).from(episodeWorkflowSigners)
      .where(and(eq(episodeWorkflowSigners.organizationId, org), eq(episodeWorkflowSigners.episodeId, episodeId), eq(episodeWorkflowSigners.personId, removed.personId))).limit(1),
  ]);
  if (pendingSignOff[0] || configuredSignOff[0]) return NextResponse.json({ error: "Choose a replacement sign-off person before removing this episode-team member." }, { status: 409 });
  await db.delete(episodeTeamAssignments).where(and(eq(episodeTeamAssignments.id, id), eq(episodeTeamAssignments.episodeId, episodeId), eq(episodeTeamAssignments.organizationId, org)));
  return NextResponse.json({ ok: true });
}
