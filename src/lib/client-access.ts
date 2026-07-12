import { and, eq, gt, isNull, or } from "drizzle-orm";

import { clientShares, people } from "@/lib/db/schema";
import { getDb } from "@/lib/db";

/**
 * External reviewers require an explicit, non-expired share. Internal users
 * are authorized by their normal role policy instead.
 */
export async function clientCanAccess(input: {
  organizationId: string;
  userId: string;
  showId?: string | null;
  episodeId?: string | null;
  reviewCutId?: string | null;
  deliverableId?: string | null;
  requireApproval?: boolean;
}) {
  const db = getDb();
  const [person] = await db.select({ id: people.id, role: people.role })
    .from(people).where(and(eq(people.organizationId, input.organizationId), eq(people.userId, input.userId))).limit(1);
  if (!person || !["client", "director", "network"].includes(person.role)) return false;
  const now = new Date();
  // A share for one resource type must not become a wildcard for another.
  // Only show/episode-scoped shares (with neither resource ID populated) may
  // grant access to related cuts or deliverables.
  const resourceScope = input.reviewCutId
    ? or(
      eq(clientShares.reviewCutId, input.reviewCutId),
      and(isNull(clientShares.reviewCutId), isNull(clientShares.deliverableId)),
    )
    : input.deliverableId
      ? or(
        eq(clientShares.deliverableId, input.deliverableId),
        and(isNull(clientShares.reviewCutId), isNull(clientShares.deliverableId)),
      )
      : and(isNull(clientShares.reviewCutId), isNull(clientShares.deliverableId));
  const shares = await db.select({ canApprove: clientShares.canApprove })
    .from(clientShares)
    .where(and(
      eq(clientShares.organizationId, input.organizationId),
      eq(clientShares.clientPersonId, person.id),
      or(isNull(clientShares.expiresAt), gt(clientShares.expiresAt, now)),
      resourceScope,
      ...(input.showId ? [or(eq(clientShares.showId, input.showId), isNull(clientShares.showId))] : []),
      ...(input.episodeId ? [or(eq(clientShares.episodeId, input.episodeId), isNull(clientShares.episodeId))] : []),
    ));
  return shares.some((share) => !input.requireApproval || share.canApprove);
}
