import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { shows } from "@/lib/db/schema";
import { ACTIVE_SHOW_COOKIE, activeOrganizationCookieOptions, getActiveOrganizationContext } from "@/lib/organizations";

const schema = z.object({ showId: z.string().uuid().nullable() });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid show." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid show." }, { status: 400 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "No active post house." }, { status: 403 });

  if (parsed.data.showId) {
    const [show] = await getDb().select({ id: shows.id }).from(shows)
      .where(and(eq(shows.id, parsed.data.showId), eq(shows.organizationId, context.organization.organizationId))).limit(1);
    if (!show) return NextResponse.json({ error: "Show not found in the active post house." }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  if (parsed.data.showId) response.cookies.set(ACTIVE_SHOW_COOKIE, parsed.data.showId, activeOrganizationCookieOptions);
  else response.cookies.delete(ACTIVE_SHOW_COOKIE);
  return response;
}
