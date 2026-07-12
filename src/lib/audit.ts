import { activityLog } from "@/lib/db/schema";
import { getDb } from "@/lib/db";

/** Keep mutation audit entries consistent without leaking audit writes into UI code. */
export async function writeAuditEvent(input: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await getDb().insert(activityLog).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}
