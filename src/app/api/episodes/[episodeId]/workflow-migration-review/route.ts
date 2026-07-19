import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { episodeWorkflowMigrationReviews } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageEpisodes, isAssignedToEpisode } from "@/lib/permissions";

const schema = z.object({ status: z.enum(["resolved", "ignored"]), resolutionNote: z.string().trim().min(3).max(2000) });

export async function PATCH(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await canManageEpisodes())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a review outcome and record a note." }, { status: 400 });
  const { episodeId } = await params;
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [review] = await getDb().update(episodeWorkflowMigrationReviews).set({ status: parsed.data.status, resolutionNote: parsed.data.resolutionNote, reviewedByUserId: context.userId, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(episodeWorkflowMigrationReviews.organizationId, context.organization.organizationId), eq(episodeWorkflowMigrationReviews.episodeId, episodeId), eq(episodeWorkflowMigrationReviews.status, "open")))
    .returning({ id: episodeWorkflowMigrationReviews.id });
  return review ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No open workflow migration review was found." }, { status: 404 });
}
