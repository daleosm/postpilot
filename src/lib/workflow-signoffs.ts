import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, people } from "@/lib/db/schema";

type SignOffRule = { id: string; approverRole: string };
type EpisodeSigner = { personId: string; name: string; role: string; isSigner: boolean };

/** A workflow role resolves only to its explicitly selected episode-team signer. */
export async function resolveEpisodeWorkflowSigners(organizationId: string, episodeId: string, rules: readonly SignOffRule[]) {
  const db = getDb();
  const team = await db.select({ personId: people.id, name: people.name, role: people.role, isSigner: episodeTeamAssignments.isLead })
    .from(episodeTeamAssignments)
    .innerJoin(people, eq(episodeTeamAssignments.personId, people.id))
    .where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, organizationId)));

  return rules.map((rule) => {
    const candidates: EpisodeSigner[] = team.filter((person) => person.role === rule.approverRole);
    const explicit = candidates.filter((person) => person.isSigner);
    const signer = explicit.length === 1 ? explicit[0] : null;
    return { ruleId: rule.id, approverRole: rule.approverRole, signer };
  });
}
