import { activityLog, crmContacts, notifications } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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
  const personIds = Array.isArray(recipients) ? [...new Set(recipients.filter((id): id is string => typeof id === "string"))] : [];
  const contactIds = Array.isArray(input.metadata?.recipientContactIds) ? [...new Set(input.metadata.recipientContactIds.filter((id): id is string => typeof id === "string"))] : [];
  const title = String(input.metadata?.notificationTitle ?? "PostPilot update");
  const body = String(input.metadata?.notificationBody ?? input.action);
  const contacts = contactIds.length ? await getDb().select({ id: crmContacts.id, email: crmContacts.email }).from(crmContacts)
    .where(and(eq(crmContacts.organizationId, input.organizationId), inArray(crmContacts.id, contactIds))) : [];
  const notificationRows = [
    ...personIds.map((personId) => ({ organizationId: input.organizationId, personId, activityId: activity.id, title, body })),
    ...contacts.filter((contact) => Boolean(contact.email)).map((contact) => ({ organizationId: input.organizationId, personId: null, crmContactId: contact.id, recipientEmail: contact.email, activityId: activity.id, title, body })),
  ];
  if (notificationRows.length) await getDb().insert(notifications).values(notificationRows);
}
