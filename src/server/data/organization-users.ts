import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationMembers, people, users } from "@/lib/db/schema";

/** Tenant-local access records. Global Auth.js users are never listed without a membership. */
export async function listOrganizationUsers(organizationId: string) {
  return getDb().select({
    userId: users.id,
    userName: users.name,
    email: users.email,
    membershipRole: organizationMembers.role,
    joinedAt: organizationMembers.joinedAt,
    personId: people.id,
    personName: people.name,
    personRole: people.role,
    isActive: people.isActive,
  }).from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .leftJoin(people, and(eq(people.organizationId, organizationMembers.organizationId), eq(people.userId, organizationMembers.userId)))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(people.name), asc(users.name), asc(users.email));
}
