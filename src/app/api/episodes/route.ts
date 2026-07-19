import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodes, people, postWorkflows, seasons, shows, workflowStages } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageEpisodes } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { insertEpisodeSchema } from "@/lib/validations/entities";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { createDeliveryManifestForNewEpisode } from "@/server/delivery-manifests";

export async function POST(request: Request) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertEpisodeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the episode details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-new-episode", debug: true }, { status: 201 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;

  const db = getDb();
  const [season] = await db.select({ id: seasons.id }).from(seasons).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(seasons.id, parsed.data.seasonId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1);
  if (!season) return NextResponse.json({ error: "Season not found." }, { status: 404 });
  const missing = await missingTenantReferences(context.organization.organizationId, {
    personId: parsed.data.assignedProducerId,
  });
  const assigneeIds = [parsed.data.editorId, parsed.data.coloristId, parsed.data.soundMixerId].filter((id): id is string => Boolean(id));
  const validAssignees = assigneeIds.length ? await db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), inArray(people.id, assigneeIds))) : [];
  if (missing.length || validAssignees.length !== assigneeIds.length) return NextResponse.json({ error: "A workflow stage or assigned person is not in this organization." }, { status: 404 });

  const { team, ...episodeData } = parsed.data;
  let episode: { id: string };
  try {
    [episode] = await db.insert(episodes).values({
      ...episodeData,
      organizationId: context.organization.organizationId,
      airDate: parsed.data.airDate ? parsed.data.airDate.toISOString().slice(0, 10) : null,
      lockedCutDate: parsed.data.lockedCutDate ? parsed.data.lockedCutDate.toISOString().slice(0, 10) : null,
    }).returning({ id: episodes.id });
  } catch {
    return NextResponse.json({ error: "An episode with that number already exists in this season." }, { status: 409 });
  }
  if (team.length) { const teamPeople = await db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, organizationId), inArray(people.id, team))); await db.insert(episodeTeamAssignments).values(teamPeople.map((person) => ({ organizationId, episodeId: episode.id, personId: person.id }))); }
  const [firstStage] = await db.select({ id: workflowStages.id })
    .from(workflowStages)
    .innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
    .where(and(eq(workflowStages.organizationId, organizationId), eq(postWorkflows.organizationId, organizationId), eq(postWorkflows.isDefault, true)))
    .orderBy(workflowStages.position)
    .limit(1);
  if (firstStage) {
    await db.update(episodes).set({ workflowStageId: firstStage.id, workflowStatus: "not_started", updatedAt: new Date() })
      .where(and(eq(episodes.organizationId, organizationId), eq(episodes.id, episode.id)));
  }
  await createDeliveryManifestForNewEpisode({ organizationId, episodeId: episode.id, appliedByUserId: context.userId });
  return NextResponse.json(episode, { status: 201 });
}
