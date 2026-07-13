import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { episodes, people, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { insertEpisodeSchema } from "@/lib/validations/entities";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { createStageWorkOrders } from "@/lib/work-orders";

export async function POST(request: Request) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertEpisodeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the episode details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-new-episode", debug: true }, { status: 201 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const [season] = await db.select({ id: seasons.id }).from(seasons).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(seasons.id, parsed.data.seasonId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1);
  if (!season) return NextResponse.json({ error: "Season not found." }, { status: 404 });
  const missing = await missingTenantReferences(context.organization.organizationId, {
    workflowStageId: parsed.data.workflowStageId,
    personId: parsed.data.assignedProducerId,
  });
  const assigneeIds = [parsed.data.editorId, parsed.data.coloristId, parsed.data.soundMixerId].filter((id): id is string => Boolean(id));
  const validAssignees = assigneeIds.length ? await db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), inArray(people.id, assigneeIds))) : [];
  if (missing.length || validAssignees.length !== assigneeIds.length) return NextResponse.json({ error: "A workflow stage or assigned person is not in this organization." }, { status: 404 });

  try {
    const [episode] = await db.insert(episodes).values({
      ...parsed.data,
      organizationId: context.organization.organizationId,
      airDate: parsed.data.airDate ? parsed.data.airDate.toISOString().slice(0, 10) : null,
      lockedCutDate: parsed.data.lockedCutDate ? parsed.data.lockedCutDate.toISOString().slice(0, 10) : null,
    }).returning({ id: episodes.id });
    if (parsed.data.workflowStageId) await createStageWorkOrders({ organizationId: context.organization.organizationId, episodeId: episode.id, workflowStageId: parsed.data.workflowStageId, createdByUserId: context.userId });
    return NextResponse.json(episode, { status: 201 });
  } catch {
    return NextResponse.json({ error: "An episode with that number already exists in this season." }, { status: 409 });
  }
}
