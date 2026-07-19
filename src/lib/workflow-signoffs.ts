import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodeWorkflowSigners, people } from "@/lib/db/schema";

type SignOffRule = { id: string };
type EpisodeSigner = { personId: string; name: string; role: string };

/** Resolves configured sign-off slots to their explicitly selected episode-team people. */
export async function resolveEpisodeWorkflowSigners(organizationId: string, episodeId: string, rules: readonly SignOffRule[]) {
  if (!rules.length) return [];
  const db = getDb();
  const assignments = await db.select({
    ruleId: episodeWorkflowSigners.workflowStageApprovalRuleId,
    personId: people.id,
    name: people.name,
    role: people.role,
  }).from(episodeWorkflowSigners)
    .innerJoin(people, eq(episodeWorkflowSigners.personId, people.id))
    .innerJoin(episodeTeamAssignments, and(eq(episodeTeamAssignments.episodeId, episodeWorkflowSigners.episodeId), eq(episodeTeamAssignments.personId, episodeWorkflowSigners.personId)))
    .where(and(
      eq(episodeWorkflowSigners.organizationId, organizationId),
      eq(episodeWorkflowSigners.episodeId, episodeId),
      inArray(episodeWorkflowSigners.workflowStageApprovalRuleId, rules.map((rule) => rule.id)),
      eq(people.organizationId, organizationId),
      eq(episodeTeamAssignments.organizationId, organizationId),
    ));
  const byRuleId = new Map(assignments.map((assignment) => [assignment.ruleId, { personId: assignment.personId, name: assignment.name, role: assignment.role } satisfies EpisodeSigner]));
  return rules.map((rule) => ({ ruleId: rule.id, signer: byRuleId.get(rule.id) ?? null }));
}
