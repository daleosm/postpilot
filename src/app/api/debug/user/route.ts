import { NextResponse } from "next/server";
import { z } from "zod";

import { DEBUG_USER_COOKIE } from "@/lib/debug-users";
import { getDebugUserByUserId } from "@/lib/debug-user";
import { getOrganizationMembershipsForUser } from "@/lib/organization-data";
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from "@/lib/organizations";
import { isDebugMode } from "@/lib/runtime";

const schema = z.object({ userId: z.string().min(1) });

export async function POST(request: Request) {
  if (!isDebugMode) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a debug user." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a debug user." }, { status: 400 });
  const user = await getDebugUserByUserId(parsed.data.userId);
  if (!user) return NextResponse.json({ error: "That debug user does not exist." }, { status: 404 });
  const memberships = await getOrganizationMembershipsForUser(user.userId);
  if (!memberships.length) return NextResponse.json({ error: "That user has no tenant membership." }, { status: 403 });
  const activeOrganization = memberships[0] ?? null;
  const response = NextResponse.json({ user, activeOrganization });
  response.cookies.set(DEBUG_USER_COOKIE, user.userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  if (activeOrganization) response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, activeOrganization.organizationId, activeOrganizationCookieOptions);
  else response.cookies.delete(ACTIVE_ORGANIZATION_COOKIE);
  return response;
}
