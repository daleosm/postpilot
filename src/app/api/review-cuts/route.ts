import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { episodes, reviewCuts, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { reviewCutRequestSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_reviews"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-new-cut", debug: true }, { status: 201 });
  const parsed = reviewCutRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the cut metadata and try again." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const [episode] = await db.select({ organizationId: shows.organizationId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const [cut] = await db.insert(reviewCuts).values({ ...parsed.data, organizationId: context.organization.organizationId, createdByUserId: context.userId, runtimeSeconds: parsed.data.runtimeSeconds ? String(parsed.data.runtimeSeconds) : null }).returning({ id: reviewCuts.id });
  return NextResponse.json(cut, { status: 201 });
}
