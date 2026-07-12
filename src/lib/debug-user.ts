import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { organizationMembers, people, users } from "@/lib/db/schema";
import { debugUsers, type DebugUser } from "@/lib/debug-users";
import { isDebugMode } from "@/lib/runtime";

export async function getDebugUser() {
  if (!isDebugMode) return null;
  const store = await cookies();
  const storedId = store.get("postpilot.debugUser")?.value;
  // Older debug sessions used a display-only debug ID. New sessions store the
  // real Auth.js user ID, allowing every seeded tenant user to be assumed.
  const preset = debugUsers.find((user) => user.id === storedId || user.userId === storedId);
  const userId = preset?.userId ?? storedId ?? debugUsers[0].userId;
  return getDebugUserByUserId(userId, preset);
}

export async function getDebugUserByUserId(userId: string, fallback?: DebugUser): Promise<DebugUser | null> {
  if (!db) return fallback ?? null;
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return fallback ?? null;
  return {
    id: user.id,
    userId: user.id,
    name: user.name ?? user.id,
    role: fallback?.role ?? "member",
    label: fallback?.label ?? "Team member",
  };
}

/** Every actual user with a membership in this tenant is available to assume in debug mode. */
export async function listDebugUsersForOrganization(organizationId: string): Promise<DebugUser[]> {
  if (!db) return [];
  const rows = await db.select({
    userId: users.id,
    name: users.name,
    personRole: people.role,
    membershipRole: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .leftJoin(people, and(eq(people.organizationId, organizationMembers.organizationId), eq(people.userId, users.id)))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(users.name), asc(users.id));

  return rows.map((row) => ({
    id: row.userId,
    userId: row.userId,
    name: row.name ?? row.userId,
    role: row.personRole ?? row.membershipRole,
    label: formatRole(row.personRole ?? row.membershipRole),
  }));
}

function formatRole(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
