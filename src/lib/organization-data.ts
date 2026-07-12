import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizationMembers, organizations } from "@/lib/db/schema";

export type OrganizationMembership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "owner" | "admin" | "member" | "guest";
};

export async function getOrganizationMembershipsForUser(userId: string): Promise<OrganizationMembership[]> {
  if (!db) return [];

  return db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.name), asc(organizations.id));
}
