import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationMembers, people, users } from "@/lib/db/schema";

export async function listTeam(organizationId: string) {
  const db = getDb();
  return db.select({ id: people.id, name: people.name, email: people.email, role: people.role, company: people.company, isActive: people.isActive, availability: people.availability, hourlyRate: people.hourlyRate, dayRate: people.dayRate, userImage: users.image, organizationRole: organizationMembers.role })
    .from(people).leftJoin(users, eq(people.userId, users.id)).leftJoin(organizationMembers, and(eq(people.userId, organizationMembers.userId), eq(organizationMembers.organizationId, organizationId)))
    .where(eq(people.organizationId, organizationId)).orderBy(asc(people.name));
}
