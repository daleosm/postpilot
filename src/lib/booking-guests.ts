import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, organizationMembers, people } from "@/lib/db/schema";

type GuestAccount = { id: string; role: string };

/** A booking may only attach a person whose account is a guest in this tenant. */
export async function getGuestAccountForBooking(organizationId: string, personId: string) {
  const [guest] = await getDb().select({ id: people.id, role: people.role })
    .from(people)
    .innerJoin(organizationMembers, and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, people.userId),
    ))
    .where(and(
      eq(people.id, personId),
      eq(people.organizationId, organizationId),
      eq(people.isActive, true),
      eq(organizationMembers.role, "guest"),
    ))
    .limit(1);
  return guest ?? null;
}

/** A guest attending episode work is always represented on the episode team. */
export async function addGuestToEpisodeTeam(organizationId: string, episodeId: string, guest: GuestAccount) {
  const db = getDb();
  const [existing] = await db.select({ id: episodeTeamAssignments.id })
    .from(episodeTeamAssignments)
    .where(and(
      eq(episodeTeamAssignments.organizationId, organizationId),
      eq(episodeTeamAssignments.episodeId, episodeId),
      eq(episodeTeamAssignments.personId, guest.id),
    ))
    .limit(1);
  if (existing) return false;
  await db.insert(episodeTeamAssignments).values({
    organizationId,
    episodeId,
    personId: guest.id,
    responsibility: guest.role,
    isLead: false,
  });
  return true;
}
