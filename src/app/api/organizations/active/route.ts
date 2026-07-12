import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { episodes, seasons, shows } from "@/lib/db/schema";
import { ACTIVE_ORGANIZATION_COOKIE, ACTIVE_SHOW_COOKIE, activeOrganizationCookieOptions, getActiveContextUserId, userCanAccessOrganization } from "@/lib/organizations";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  pathname: z.string().max(2048).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Invalid pathname.").optional().default("/"),
});

export async function POST(request: Request) {
  const userId = await getActiveContextUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid organization." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid organization." }, { status: 400 });

  const isMember = await userCanAccessOrganization(userId, parsed.data.organizationId);
  if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const redirectTo = await validTenantRoute(parsed.data.organizationId, parsed.data.pathname);
  const response = NextResponse.json({ ok: true, redirectTo });
  response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, parsed.data.organizationId, activeOrganizationCookieOptions);
  // A show ID is meaningful only within its original tenant. Reset it before
  // rendering the new workspace so the top bar and every server query agree.
  response.cookies.delete(ACTIVE_SHOW_COOKIE);
  return response;
}

/** Nested records from another tenant are never preserved as the destination route. */
async function validTenantRoute(organizationId: string, pathname: string) {
  const path = pathname.split("?")[0];
  const show = path.match(/^\/shows\/([^/]+)$/);
  const episode = path.match(/^\/episodes\/([^/]+)$/);
  const db = getDb();

  if (show) {
    const [record] = await db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, show[1]), eq(shows.organizationId, organizationId))).limit(1);
    return record ? path : "/";
  }
  if (episode) {
    const [record] = await db.select({ id: episodes.id }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(episodes.id, episode[1]), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
    return record ? path : "/";
  }
  if (/^\/review\/[^/]+$/.test(path)) return "/";
  return path;
}
