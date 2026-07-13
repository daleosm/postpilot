import { activityLog, notifications } from "@/lib/db/schema";
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
  const [activity] = await getDb().insert(activityLog).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  }).returning({ id: activityLog.id });
  const recipients = input.metadata?.recipientPersonIds;
  if (Array.isArray(recipients)) await getDb().insert(notifications).values(recipients.filter((id): id is string => typeof id === "string").map((personId) => ({ organizationId: input.organizationId, personId, activityId: activity.id, title: String(input.metadata?.notificationTitle ?? "Booking updated"), body: String(input.metadata?.notificationBody ?? input.action) })));
}
