import "server-only";

import { and, asc, desc, eq, inArray, max, ne, notInArray, or, sql } from "drizzle-orm";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { getEpisodeWorkflowStates } from "@/server/data/episode-workflow-state";
import { getDeliveryManifestReadiness, validateDeliveryItemTransition } from "@/lib/delivery-lifecycle";
import { getDeliveryWorkflowGateReadiness } from "@/lib/delivery-workflow-gate";
import {
  activityLog,
  crmCompanies,
  crmContacts,
  deliveryProfileItems,
  deliveryProfiles,
  episodeDeliveryAcceptanceExceptions,
  episodeDeliveryItems,
  episodeDeliveryManifests,
  episodeDeliveryManifestShares,
  episodeTeamAssignments,
  episodes,
  organizationMembers,
  people,
  seasons,
  shows,
  postWorkOrders,
  postWorkflows,
  showContacts,
  users,
  workflowStages,
} from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import {
  addEpisodeDeliveryItemSchema,
  applyDeliveryProfileSchema,
  createDeliveryProfileItemSchema,
  createDeliveryProfileSchema,
  removeEpisodeDeliveryItemSchema,
  shareEpisodeDeliveryManifestSchema,
  transitionEpisodeDeliveryItemSchema,
  authorizeDeliveryAcceptanceExceptionSchema,
  updateDeliveryProfileItemSchema,
  updateDeliveryProfileSchema,
  updateEpisodeDeliveryItemSchema,
} from "@/lib/validations/entities";

export class DeliveryManifestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type EpisodeScope = {
  episodeId: string;
  showId: string;
  clientCompanyId: string | null;
  network: string | null;
  deliveryDeadline: Date | null;
};

type DeliveryProfileScope = {
  id: string;
  organizationId: string;
  clientCompanyId: string | null;
  network: string | null;
  showId: string | null;
  name: string;
  specificationUrl: string | null;
  isActive: boolean;
};

const toDate = (value: Date | string | null | undefined) => value ? (typeof value === "string" ? value : value.toISOString().slice(0, 10)) : null;

function deadlineFromEpisode(deadline: Date | null, offsetDays: number | null) {
  if (!deadline) return null;
  const date = new Date(deadline);
  date.setUTCDate(date.getUTCDate() + (offsetDays ?? 0));
  return date.toISOString().slice(0, 10);
}

async function requireDeliveryCapability(permission: "manage_delivery_profiles" | "manage_episode_manifests" | "update_delivery_items" | "confirm_delivery_receipt", message: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) throw new DeliveryManifestError(401, "No active post house.");
  if (context.organization.role === "client" || !(await can(permission))) throw new DeliveryManifestError(403, message);
  return { organizationId: context.organization.organizationId, userId: context.userId, personId: context.person?.id ?? null };
}

async function getEpisodeScope(organizationId: string, episodeId: string): Promise<EpisodeScope | null> {
  const [episode] = await getDb().select({
    episodeId: episodes.id,
    showId: shows.id,
    clientCompanyId: shows.clientCompanyId,
    network: shows.network,
    deliveryDeadline: episodes.deliveryDeadline,
  }).from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(
      eq(episodes.id, episodeId),
      eq(episodes.organizationId, organizationId),
      eq(seasons.organizationId, organizationId),
      eq(shows.organizationId, organizationId),
    )).limit(1);
  return episode ?? null;
}

/** Only the assigned episode team and the named delivery contacts receive delivery notices. */
async function getDeliveryNotificationAudience(input: { organizationId: string; episodeId: string; contactIds?: Array<string | null | undefined>; excludePersonId?: string | null }) {
  const team = await getDb().select({ personId: people.id }).from(people)
    .innerJoin(episodeTeamAssignments, and(eq(episodeTeamAssignments.personId, people.id), eq(episodeTeamAssignments.organizationId, input.organizationId)))
    .where(and(eq(people.organizationId, input.organizationId), eq(episodeTeamAssignments.episodeId, input.episodeId)));
  return {
    recipientPersonIds: [...new Set(team.map((member) => member.personId).filter((personId) => personId !== input.excludePersonId))],
    recipientContactIds: [...new Set((input.contactIds ?? []).filter((contactId): contactId is string => Boolean(contactId)))],
  };
}

function deliveryNotificationMetadata(audience: { recipientPersonIds: string[]; recipientContactIds: string[] }, title: string, body: string) {
  return { ...audience, notificationTitle: title, notificationBody: body };
}

async function getDeliveryProfileScope(organizationId: string, profileId: string): Promise<DeliveryProfileScope | null> {
  const [profile] = await getDb().select({
    id: deliveryProfiles.id,
    organizationId: deliveryProfiles.organizationId,
    clientCompanyId: deliveryProfiles.clientCompanyId,
    network: deliveryProfiles.network,
    showId: deliveryProfiles.showId,
    name: deliveryProfiles.name,
    specificationUrl: deliveryProfiles.specificationUrl,
    isActive: deliveryProfiles.isActive,
  }).from(deliveryProfiles)
    .where(and(eq(deliveryProfiles.id, profileId), eq(deliveryProfiles.organizationId, organizationId))).limit(1);
  return profile ?? null;
}

function assertProfileAppliesToEpisode(profile: DeliveryProfileScope, episode: EpisodeScope) {
  if (profile.showId && profile.showId !== episode.showId) {
    throw new DeliveryManifestError(409, "This delivery profile is restricted to a different show.");
  }
  if (profile.clientCompanyId && profile.clientCompanyId !== episode.clientCompanyId) {
    throw new DeliveryManifestError(409, "This delivery profile belongs to a different client account.");
  }
  if (profile.network && profile.network !== episode.network) {
    throw new DeliveryManifestError(409, "This delivery profile belongs to a different network.");
  }
}

/**
 * Recipient choices are intentionally narrow: show-assigned technical/client
 * review contacts, plus a network or studio contact where the facility has
 * not assigned a more specific show contact yet.
 */
export async function listDeliveryRecipientContactsForShow(organizationId: string, showId: string) {
  const [show] = await getDb().select({ id: shows.id }).from(shows)
    .where(and(eq(shows.id, showId), eq(shows.organizationId, organizationId))).limit(1);
  if (!show) throw new DeliveryManifestError(404, "Show not found in this post house.");
  return getDb().selectDistinct({
    id: crmContacts.id,
    name: crmContacts.name,
    email: crmContacts.email,
    title: crmContacts.title,
    contactType: crmContacts.contactType,
    companyName: crmCompanies.name,
    companyType: crmCompanies.type,
    showAssigned: sql<boolean>`${showContacts.id} is not null`,
  }).from(crmContacts)
    .innerJoin(crmCompanies, and(eq(crmContacts.companyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .leftJoin(showContacts, and(
      eq(showContacts.contactId, crmContacts.id),
      eq(showContacts.organizationId, organizationId),
      eq(showContacts.showId, showId),
    ))
    .where(and(
      eq(crmContacts.organizationId, organizationId),
      or(
        and(sql`${showContacts.id} is not null`, inArray(crmContacts.contactType, ["technical_delivery", "client_review"])),
        inArray(crmCompanies.type, ["network", "studio"]),
      ),
    )).orderBy(asc(crmCompanies.name), asc(crmContacts.name));
}

export async function listActiveDeliveryRecipientContacts(episodeId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) throw new DeliveryManifestError(401, "No active post house.");
  if (context.organization.role === "client" || !((await can("manage_episode_manifests")) || (await can("update_delivery_items")))) {
    throw new DeliveryManifestError(403, "Your role cannot choose delivery recipients.");
  }
  const episode = await getEpisodeScope(context.organization.organizationId, episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found in this post house.");
  return listDeliveryRecipientContactsForShow(context.organization.organizationId, episode.showId);
}

async function getEligibleDeliveryRecipientSnapshot(organizationId: string, episode: EpisodeScope, contactId: string | null | undefined) {
  if (!contactId) return null;
  const contact = (await listDeliveryRecipientContactsForShow(organizationId, episode.showId)).find((candidate) => candidate.id === contactId);
  if (!contact) throw new DeliveryManifestError(409, "Choose a show delivery contact or an eligible network/studio contact.");
  return { id: contact.id, name: contact.name, email: contact.email };
}

async function validateProfileRecipient(organizationId: string, profile: DeliveryProfileScope, contactId: string | null | undefined) {
  if (!contactId) return null;
  if (!profile.showId) {
    const [contact] = await getDb().select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email })
      .from(crmContacts)
      .innerJoin(crmCompanies, and(eq(crmContacts.companyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.organizationId, organizationId), inArray(crmCompanies.type, ["network", "studio"]))).limit(1);
    if (!contact) throw new DeliveryManifestError(409, "Choose an eligible network or studio delivery contact.");
    return contact;
  }
  const contact = (await listDeliveryRecipientContactsForShow(organizationId, profile.showId)).find((candidate) => candidate.id === contactId);
  if (!contact) throw new DeliveryManifestError(409, "Choose a show delivery contact or an eligible network/studio contact.");
  return contact;
}

async function validateProfileReferences(organizationId: string, scope: { clientCompanyId: string | null; network: string | null; showId: string | null }) {
  if (scope.clientCompanyId) {
    const [company] = await getDb().select({ type: crmCompanies.type }).from(crmCompanies)
      .where(and(eq(crmCompanies.id, scope.clientCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1);
    if (!company || company.type === "vendor") throw new DeliveryManifestError(404, "Client or network account not found in this post house.");
  }
  if (!scope.showId) return;
  const [show] = await getDb().select({ id: shows.id, clientCompanyId: shows.clientCompanyId, network: shows.network }).from(shows)
    .where(and(eq(shows.id, scope.showId), eq(shows.organizationId, organizationId))).limit(1);
  if (!show) throw new DeliveryManifestError(404, "Show not found in this post house.");
  if (scope.clientCompanyId && scope.clientCompanyId !== show.clientCompanyId) throw new DeliveryManifestError(409, "The selected show belongs to a different client account.");
  if (scope.network && scope.network !== show.network) throw new DeliveryManifestError(409, "The selected show belongs to a different network.");
}

async function copyProfileSnapshot(input: {
  organizationId: string;
  episode: EpisodeScope;
  profile: DeliveryProfileScope;
  appliedByUserId: string | null;
}) {
  const db = getDb();
  const profileItems = await db.select({
    id: deliveryProfileItems.id,
    componentType: deliveryProfileItems.componentType,
    label: deliveryProfileItems.label,
    required: deliveryProfileItems.required,
    formatSpecification: deliveryProfileItems.formatSpecification,
    version: deliveryProfileItems.version,
    territory: deliveryProfileItems.territory,
    language: deliveryProfileItems.language,
    recipientContactId: deliveryProfileItems.recipientContactId,
    recipientName: crmContacts.name,
    recipientEmail: crmContacts.email,
    requiresExternalRecipient: deliveryProfileItems.requiresExternalRecipient,
    qcRequired: deliveryProfileItems.qcRequired,
    defaultDeadlineOffsetDays: deliveryProfileItems.defaultDeadlineOffsetDays,
    position: deliveryProfileItems.position,
  }).from(deliveryProfileItems)
    .leftJoin(crmContacts, and(eq(deliveryProfileItems.recipientContactId, crmContacts.id), eq(crmContacts.organizationId, input.organizationId)))
    .where(and(eq(deliveryProfileItems.organizationId, input.organizationId), eq(deliveryProfileItems.deliveryProfileId, input.profile.id)))
    .orderBy(asc(deliveryProfileItems.position));

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: episodeDeliveryManifests.id }).from(episodeDeliveryManifests)
      .where(and(eq(episodeDeliveryManifests.organizationId, input.organizationId), eq(episodeDeliveryManifests.episodeId, input.episode.episodeId))).limit(1);
    if (existing) await tx.delete(episodeDeliveryManifests)
      .where(and(eq(episodeDeliveryManifests.id, existing.id), eq(episodeDeliveryManifests.organizationId, input.organizationId)));

    const [manifest] = await tx.insert(episodeDeliveryManifests).values({
      organizationId: input.organizationId,
      episodeId: input.episode.episodeId,
      deliveryProfileId: input.profile.id,
      profileName: input.profile.name,
      specificationUrl: input.profile.specificationUrl,
      appliedByUserId: input.appliedByUserId,
    }).returning({ id: episodeDeliveryManifests.id });

    if (profileItems.length) await tx.insert(episodeDeliveryItems).values(profileItems.map((item) => ({
      organizationId: input.organizationId,
      episodeDeliveryManifestId: manifest.id,
      episodeId: input.episode.episodeId,
      deliveryProfileItemId: item.id,
      componentType: item.componentType,
      label: item.label,
      required: item.required,
      formatSpecification: item.formatSpecification,
      version: item.version,
      territory: item.territory,
      language: item.language,
      recipientContactId: item.recipientContactId,
      recipientName: item.recipientName,
      recipientEmail: item.recipientEmail,
      requiresExternalRecipient: item.requiresExternalRecipient,
      qcRequired: item.qcRequired,
      dueDate: deadlineFromEpisode(input.episode.deliveryDeadline, item.defaultDeadlineOffsetDays),
      qcResult: item.qcRequired ? "not_started" as const : "not_required" as const,
      position: item.position,
    })));
    return { id: manifest.id, replacedExisting: Boolean(existing), itemCount: profileItems.length };
  });
}

/** A tenant-scoped template list for a future settings or show-detail screen. */
export async function listDeliveryProfilesForOrganization(organizationId: string) {
  return getDb().select({
    id: deliveryProfiles.id,
    name: deliveryProfiles.name,
    clientCompanyId: deliveryProfiles.clientCompanyId,
    network: deliveryProfiles.network,
    showId: deliveryProfiles.showId,
    specificationUrl: deliveryProfiles.specificationUrl,
    isActive: deliveryProfiles.isActive,
    updatedAt: deliveryProfiles.updatedAt,
  }).from(deliveryProfiles)
    .where(eq(deliveryProfiles.organizationId, organizationId))
    .orderBy(asc(deliveryProfiles.name));
}

export async function getDeliveryProfileForOrganization(organizationId: string, profileId: string) {
  const profile = await getDeliveryProfileScope(organizationId, profileId);
  if (!profile) return null;
  const items = await getDb().select({
    id: deliveryProfileItems.id,
    componentType: deliveryProfileItems.componentType,
    label: deliveryProfileItems.label,
    required: deliveryProfileItems.required,
    formatSpecification: deliveryProfileItems.formatSpecification,
    version: deliveryProfileItems.version,
    territory: deliveryProfileItems.territory,
    language: deliveryProfileItems.language,
    recipientContactId: deliveryProfileItems.recipientContactId,
    recipientName: crmContacts.name,
    recipientEmail: crmContacts.email,
    requiresExternalRecipient: deliveryProfileItems.requiresExternalRecipient,
    qcRequired: deliveryProfileItems.qcRequired,
    defaultDeadlineOffsetDays: deliveryProfileItems.defaultDeadlineOffsetDays,
    position: deliveryProfileItems.position,
  }).from(deliveryProfileItems)
    .leftJoin(crmContacts, and(eq(deliveryProfileItems.recipientContactId, crmContacts.id), eq(crmContacts.organizationId, organizationId)))
    .where(and(eq(deliveryProfileItems.organizationId, organizationId), eq(deliveryProfileItems.deliveryProfileId, profileId)))
    .orderBy(asc(deliveryProfileItems.position));
  return {
    ...profile,
    items,
    missingRequiredRecipientCount: items.filter((item) => item.requiresExternalRecipient && !item.recipientContactId).length,
  };
}

/** Reads exactly one episode's manifest; no show or tenant-wide fallback is used. */
export async function getEpisodeDeliveryManifestForOrganization(organizationId: string, episodeId: string) {
  const [manifest] = await getDb().select({
    id: episodeDeliveryManifests.id,
    episodeId: episodeDeliveryManifests.episodeId,
    deliveryProfileId: episodeDeliveryManifests.deliveryProfileId,
    profileName: episodeDeliveryManifests.profileName,
    specificationUrl: episodeDeliveryManifests.specificationUrl,
    appliedAt: episodeDeliveryManifests.appliedAt,
    updatedAt: episodeDeliveryManifests.updatedAt,
  }).from(episodeDeliveryManifests)
    .innerJoin(episodes, eq(episodeDeliveryManifests.episodeId, episodes.id))
    .where(and(
      eq(episodeDeliveryManifests.organizationId, organizationId),
      eq(episodeDeliveryManifests.episodeId, episodeId),
      eq(episodes.organizationId, organizationId),
    )).limit(1);
  if (!manifest) return null;
  const [items, history] = await Promise.all([getDb().select({
    id: episodeDeliveryItems.id,
    deliveryProfileItemId: episodeDeliveryItems.deliveryProfileItemId,
    componentType: episodeDeliveryItems.componentType,
    label: episodeDeliveryItems.label,
    required: episodeDeliveryItems.required,
    formatSpecification: episodeDeliveryItems.formatSpecification,
    version: episodeDeliveryItems.version,
    territory: episodeDeliveryItems.territory,
    language: episodeDeliveryItems.language,
    recipientContactId: episodeDeliveryItems.recipientContactId,
    recipientName: episodeDeliveryItems.recipientName,
    recipientEmail: episodeDeliveryItems.recipientEmail,
    requiresExternalRecipient: episodeDeliveryItems.requiresExternalRecipient,
    recipientSnapshotAt: episodeDeliveryItems.recipientSnapshotAt,
    qcRequired: episodeDeliveryItems.qcRequired,
    status: episodeDeliveryItems.status,
    dueDate: episodeDeliveryItems.dueDate,
    isExternallyShared: episodeDeliveryItems.isExternallyShared,
    externalUrl: episodeDeliveryItems.externalUrl,
    externalReference: episodeDeliveryItems.externalReference,
    submissionMethod: episodeDeliveryItems.submissionMethod,
    submittedByPersonId: episodeDeliveryItems.submittedByPersonId,
    submittedAt: episodeDeliveryItems.submittedAt,
    qcResult: episodeDeliveryItems.qcResult,
    receiptConfirmedAt: episodeDeliveryItems.receiptConfirmedAt,
    receiptConfirmedBy: episodeDeliveryItems.receiptConfirmedBy,
    rejectionReason: episodeDeliveryItems.rejectionReason,
    waiverReason: episodeDeliveryItems.waiverReason,
    position: episodeDeliveryItems.position,
  }).from(episodeDeliveryItems)
    .where(and(
      eq(episodeDeliveryItems.organizationId, organizationId),
      eq(episodeDeliveryItems.episodeDeliveryManifestId, manifest.id),
      eq(episodeDeliveryItems.episodeId, episodeId),
    )).orderBy(asc(episodeDeliveryItems.position)),
  getDb().select({
    id: activityLog.id,
    action: activityLog.action,
    metadata: activityLog.metadata,
    createdAt: activityLog.createdAt,
    actorName: users.name,
  }).from(activityLog)
    .leftJoin(users, eq(activityLog.actorUserId, users.id))
    .where(and(
      eq(activityLog.organizationId, organizationId),
      sql`${activityLog.metadata}->>'episodeId' = ${episodeId}`,
      or(sql`${activityLog.action} LIKE 'episode_delivery_%'`, sql`${activityLog.action} LIKE 'delivery_%'`),
    )).orderBy(desc(activityLog.createdAt)).limit(60)]);
  return { ...manifest, items, history, readiness: getDeliveryManifestReadiness(items) };
}

/**
 * Internal operational register.  It deliberately derives each row from the
 * immutable episode snapshot, rather than from a delivery profile, so its
 * progress and risk figures always reflect the work actually being delivered.
 */
export async function listDeliveryRegisterForOrganization(organizationId: string) {
  const rows = await getDb().select({
    manifestId: episodeDeliveryManifests.id,
    episodeId: episodes.id,
    episodeNumber: episodes.number,
    episodeTitle: episodes.title,
    productionCode: episodes.productionCode,
    showId: shows.id,
    showTitle: shows.title,
    seasonNumber: seasons.number,
    deliveryDeadline: episodes.deliveryDeadline,
  }).from(episodes)
    .innerJoin(seasons, and(eq(episodes.seasonId, seasons.id), eq(seasons.organizationId, organizationId)))
    .innerJoin(shows, and(eq(seasons.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(episodeDeliveryManifests, and(eq(episodeDeliveryManifests.episodeId, episodes.id), eq(episodeDeliveryManifests.organizationId, organizationId)))
    .where(eq(episodes.organizationId, organizationId))
    .orderBy(asc(shows.title), asc(seasons.number), asc(episodes.number));

  const workflowStates = await getEpisodeWorkflowStates(organizationId, rows.map((row) => row.episodeId));
  return Promise.all(rows.map(async (row) => {
    const workflowState = workflowStates.get(row.episodeId) ?? null;
    if (!row.manifestId) return { ...row, workflowState, manifest: null, manifestState: "profile_not_applied" as const };
    const manifest = await getEpisodeDeliveryManifestForOrganization(organizationId, row.episodeId);
    // The join guarantees a manifest exists, but retaining this guard makes
    // concurrent manifest replacement harmless to the register.
    if (!manifest) return { ...row, workflowState, manifest: null, manifestState: "profile_not_applied" as const };
    return { ...row, workflowState, manifest, manifestState: "applied" as const };
  })).then((items) => items.filter((item): item is NonNullable<typeof item> => Boolean(item)));
}

/** A small show-detail projection for producers: summary only, never item metadata. */
export async function getShowDeliverySummaryForOrganization(organizationId: string, showId: string) {
  const [show] = await getDb().select({ id: shows.id }).from(shows)
    .where(and(eq(shows.id, showId), eq(shows.organizationId, organizationId))).limit(1);
  if (!show) return null;
  const register = await listDeliveryRegisterForOrganization(organizationId);
  const entries = register.filter((entry) => entry.showId === showId);
  const totals = entries.reduce((summary, entry) => {
    if (!entry.manifest) { summary.profileNotApplied += 1; return summary; }
    const readiness = entry.manifest.readiness;
    summary.required += readiness.requiredItemCount;
    summary.complete += readiness.completedRequiredItemCount;
    summary.blocked += entry.manifest.items.filter((item) => item.required && ["qc_failed", "rejected"].includes(item.status)).length;
    summary.overdue += readiness.overdueRequiredItemCount;
    summary.atRisk += readiness.atRiskRequiredItemCount;
    return summary;
  }, { required: 0, complete: 0, blocked: 0, overdue: 0, atRisk: 0, profileNotApplied: 0 });
  return {
    episodeCount: entries.length,
    ...totals,
    facilityDispatchedCount: entries.filter((entry) => entry.manifest?.readiness.facilityDispatched).length,
    receiptConfirmedCount: entries.filter((entry) => entry.manifest?.readiness.clientNetworkAccepted).length,
  };
}

/**
 * The only externally-readable manifest projection. It deliberately omits
 * QC results, waiver/rejection context, recipient identity, profile links, and
 * every reference that has not been individually marked for external sharing.
 */
export async function getActiveSharedDeliveryManifest(episodeId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization || !context.person) throw new DeliveryManifestError(401, "No active external account.");
  if (!(await can("view_shared_delivery_status"))) throw new DeliveryManifestError(403, "Your role cannot view shared delivery status.");
  const organizationId = context.organization.organizationId;
  const [manifest] = await getDb().select({
    id: episodeDeliveryManifests.id,
    episodeId: episodeDeliveryManifests.episodeId,
    profileName: episodeDeliveryManifests.profileName,
    appliedAt: episodeDeliveryManifests.appliedAt,
  }).from(episodeDeliveryManifests)
    .innerJoin(episodeDeliveryManifestShares, and(
      eq(episodeDeliveryManifestShares.episodeDeliveryManifestId, episodeDeliveryManifests.id),
      eq(episodeDeliveryManifestShares.organizationId, organizationId),
      eq(episodeDeliveryManifestShares.personId, context.person.id),
    ))
    .innerJoin(episodes, and(eq(episodeDeliveryManifests.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .where(and(
      eq(episodeDeliveryManifests.organizationId, organizationId),
      eq(episodeDeliveryManifests.episodeId, episodeId),
    )).limit(1);
  if (!manifest) throw new DeliveryManifestError(404, "Shared delivery manifest not found.");
  const items = await getDb().select({
    id: episodeDeliveryItems.id,
    componentType: episodeDeliveryItems.componentType,
    label: episodeDeliveryItems.label,
    required: episodeDeliveryItems.required,
    version: episodeDeliveryItems.version,
    territory: episodeDeliveryItems.territory,
    language: episodeDeliveryItems.language,
    status: episodeDeliveryItems.status,
    dueDate: episodeDeliveryItems.dueDate,
    isExternallyShared: episodeDeliveryItems.isExternallyShared,
    externalUrl: episodeDeliveryItems.externalUrl,
    externalReference: episodeDeliveryItems.externalReference,
    submissionMethod: episodeDeliveryItems.submissionMethod,
    receiptConfirmedAt: episodeDeliveryItems.receiptConfirmedAt,
    position: episodeDeliveryItems.position,
  }).from(episodeDeliveryItems).where(and(
    eq(episodeDeliveryItems.organizationId, organizationId),
    eq(episodeDeliveryItems.episodeDeliveryManifestId, manifest.id),
    eq(episodeDeliveryItems.episodeId, episodeId),
  )).orderBy(asc(episodeDeliveryItems.position));
  return {
    ...manifest,
    items: items.map(({ isExternallyShared, externalUrl, externalReference, ...item }) => ({
      ...item,
      externalUrl: isExternallyShared ? externalUrl : null,
      externalReference: isExternallyShared ? externalReference : null,
    })),
  };
}

/** Shares one manifest to a named external tenant person; sharing is never tenant-wide. */
export async function shareActiveEpisodeDeliveryManifest(episodeId: string, payload: unknown) {
  const parsed = shareEpisodeDeliveryManifestSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Choose an external recipient.");
  const context = await requireDeliveryCapability("manage_episode_manifests", "Your role needs the Manage episode manifests permission.");
  const [manifest, target] = await Promise.all([
    getDb().select({ id: episodeDeliveryManifests.id }).from(episodeDeliveryManifests).where(and(eq(episodeDeliveryManifests.organizationId, context.organizationId), eq(episodeDeliveryManifests.episodeId, episodeId))).limit(1),
    getDb().select({ id: people.id, userId: people.userId, membershipRole: organizationMembers.role }).from(people)
      .innerJoin(organizationMembers, and(eq(organizationMembers.userId, people.userId), eq(organizationMembers.organizationId, context.organizationId)))
      .where(and(eq(people.id, parsed.data.personId), eq(people.organizationId, context.organizationId))).limit(1),
  ]);
  if (!manifest[0]) throw new DeliveryManifestError(404, "Delivery manifest not found.");
  if (!target[0] || target[0].membershipRole !== "client") throw new DeliveryManifestError(404, "External recipient not found in this post house.");
  const [share] = await getDb().insert(episodeDeliveryManifestShares).values({
    organizationId: context.organizationId,
    episodeDeliveryManifestId: manifest[0].id,
    personId: target[0].id,
    sharedByUserId: context.userId,
  }).onConflictDoUpdate({
    target: [episodeDeliveryManifestShares.episodeDeliveryManifestId, episodeDeliveryManifestShares.personId],
    set: { sharedByUserId: context.userId, updatedAt: new Date() },
  }).returning({ id: episodeDeliveryManifestShares.id });
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_manifest.shared", entityType: "episode_delivery_manifest", entityId: manifest[0].id, metadata: { episodeId, personId: target[0].id } });
  return share;
}

export async function unshareActiveEpisodeDeliveryManifest(episodeId: string, payload: unknown) {
  const parsed = shareEpisodeDeliveryManifestSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Choose an external recipient.");
  const context = await requireDeliveryCapability("manage_episode_manifests", "Your role needs the Manage episode manifests permission.");
  const [manifest] = await getDb().select({ id: episodeDeliveryManifests.id }).from(episodeDeliveryManifests)
    .where(and(eq(episodeDeliveryManifests.organizationId, context.organizationId), eq(episodeDeliveryManifests.episodeId, episodeId))).limit(1);
  if (!manifest) throw new DeliveryManifestError(404, "Delivery manifest not found.");
  const [share] = await getDb().delete(episodeDeliveryManifestShares).where(and(
    eq(episodeDeliveryManifestShares.organizationId, context.organizationId),
    eq(episodeDeliveryManifestShares.episodeDeliveryManifestId, manifest.id),
    eq(episodeDeliveryManifestShares.personId, parsed.data.personId),
  )).returning({ id: episodeDeliveryManifestShares.id });
  if (!share) throw new DeliveryManifestError(404, "External manifest share not found.");
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_manifest.unshared", entityType: "episode_delivery_manifest", entityId: manifest.id, metadata: { episodeId, personId: parsed.data.personId } });
}

export async function createActiveDeliveryProfile(payload: unknown) {
  const parsed = createDeliveryProfileSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery profile.");
  const context = await requireDeliveryCapability("manage_delivery_profiles", "Your role needs the Manage delivery profiles permission.");
  await validateProfileReferences(context.organizationId, {
    clientCompanyId: parsed.data.clientCompanyId ?? null,
    network: parsed.data.network ?? null,
    showId: parsed.data.showId ?? null,
  });
  try {
    const [profile] = await getDb().insert(deliveryProfiles).values({ ...parsed.data, organizationId: context.organizationId }).returning({ id: deliveryProfiles.id });
    await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "delivery_profile.created", entityType: "delivery_profile", entityId: profile.id });
    return getDeliveryProfileForOrganization(context.organizationId, profile.id);
  } catch {
    throw new DeliveryManifestError(409, "A delivery profile with that name already exists in this post house.");
  }
}

/** Editing a profile changes future applications only; snapshot manifests are never propagated. */
export async function updateActiveDeliveryProfile(profileId: string, payload: unknown) {
  const parsed = updateDeliveryProfileSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery profile.");
  const context = await requireDeliveryCapability("manage_delivery_profiles", "Your role needs the Manage delivery profiles permission.");
  const profile = await getDeliveryProfileScope(context.organizationId, profileId);
  if (!profile) throw new DeliveryManifestError(404, "Delivery profile not found.");
  await validateProfileReferences(context.organizationId, {
    clientCompanyId: parsed.data.clientCompanyId === undefined ? profile.clientCompanyId : parsed.data.clientCompanyId ?? null,
    network: parsed.data.network === undefined ? profile.network : parsed.data.network ?? null,
    showId: parsed.data.showId === undefined ? profile.showId : parsed.data.showId ?? null,
  });
  if (parsed.data.name) {
    const [nameConflict] = await getDb().select({ id: deliveryProfiles.id }).from(deliveryProfiles).where(and(
      eq(deliveryProfiles.organizationId, context.organizationId),
      eq(deliveryProfiles.name, parsed.data.name),
      ne(deliveryProfiles.id, profileId),
    )).limit(1);
    if (nameConflict) throw new DeliveryManifestError(409, "A delivery profile with that name already exists in this post house.");
  }
  await getDb().update(deliveryProfiles).set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(deliveryProfiles.id, profileId), eq(deliveryProfiles.organizationId, context.organizationId)));
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "delivery_profile.updated", entityType: "delivery_profile", entityId: profileId });
  return getDeliveryProfileForOrganization(context.organizationId, profileId);
}

export async function addActiveDeliveryProfileItem(profileId: string, payload: unknown) {
  const parsed = createDeliveryProfileItemSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery profile item.");
  const context = await requireDeliveryCapability("manage_delivery_profiles", "Your role needs the Manage delivery profiles permission.");
  const profile = await getDeliveryProfileScope(context.organizationId, profileId);
  if (!profile) throw new DeliveryManifestError(404, "Delivery profile not found.");
  await validateProfileRecipient(context.organizationId, profile, parsed.data.recipientContactId);
  try {
    const [item] = await getDb().insert(deliveryProfileItems).values({ ...parsed.data, organizationId: context.organizationId, deliveryProfileId: profileId }).returning({ id: deliveryProfileItems.id });
    await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "delivery_profile.item_added", entityType: "delivery_profile", entityId: profileId, metadata: { deliveryProfileItemId: item.id } });
    return item;
  } catch {
    throw new DeliveryManifestError(409, "A delivery item already uses that position on this profile.");
  }
}

export async function updateActiveDeliveryProfileItem(profileId: string, itemId: string, payload: unknown) {
  const parsed = updateDeliveryProfileItemSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery profile item.");
  const context = await requireDeliveryCapability("manage_delivery_profiles", "Your role needs the Manage delivery profiles permission.");
  const [item] = await getDb().select({ id: deliveryProfileItems.id }).from(deliveryProfileItems)
    .where(and(eq(deliveryProfileItems.id, itemId), eq(deliveryProfileItems.deliveryProfileId, profileId), eq(deliveryProfileItems.organizationId, context.organizationId))).limit(1);
  if (!item) throw new DeliveryManifestError(404, "Delivery profile item not found.");
  const profile = await getDeliveryProfileScope(context.organizationId, profileId);
  if (!profile) throw new DeliveryManifestError(404, "Delivery profile not found.");
  if (parsed.data.recipientContactId !== undefined) await validateProfileRecipient(context.organizationId, profile, parsed.data.recipientContactId);
  if (parsed.data.position !== undefined) {
    const [positionConflict] = await getDb().select({ id: deliveryProfileItems.id }).from(deliveryProfileItems).where(and(
      eq(deliveryProfileItems.organizationId, context.organizationId),
      eq(deliveryProfileItems.deliveryProfileId, profileId),
      eq(deliveryProfileItems.position, parsed.data.position),
      ne(deliveryProfileItems.id, itemId),
    )).limit(1);
    if (positionConflict) throw new DeliveryManifestError(409, "A delivery item already uses that position on this profile.");
  }
  await getDb().update(deliveryProfileItems).set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(deliveryProfileItems.id, itemId), eq(deliveryProfileItems.deliveryProfileId, profileId), eq(deliveryProfileItems.organizationId, context.organizationId)));
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "delivery_profile.item_updated", entityType: "delivery_profile", entityId: profileId, metadata: { deliveryProfileItemId: itemId } });
}

/** Selects one applicable profile for a show. It affects only episodes created afterwards. */
export async function selectActiveDeliveryProfileForShow(showId: string, profileId: string | null) {
  const context = await requireDeliveryCapability("manage_delivery_profiles", "Your role needs the Manage delivery profiles permission.");
  const [show] = await getDb().select({ id: shows.id, clientCompanyId: shows.clientCompanyId, network: shows.network }).from(shows)
    .where(and(eq(shows.id, showId), eq(shows.organizationId, context.organizationId))).limit(1);
  if (!show) throw new DeliveryManifestError(404, "Show not found in this post house.");
  if (profileId) {
    const profile = await getDeliveryProfileScope(context.organizationId, profileId);
    if (!profile || !profile.isActive) throw new DeliveryManifestError(404, "Active delivery profile not found in this post house.");
    assertProfileAppliesToEpisode(profile, { episodeId: "", showId: show.id, clientCompanyId: show.clientCompanyId, network: show.network, deliveryDeadline: null });
  }
  await getDb().update(shows).set({ deliveryProfileId: profileId, updatedAt: new Date() })
    .where(and(eq(shows.id, showId), eq(shows.organizationId, context.organizationId)));
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "show.delivery_profile_selected", entityType: "show", entityId: showId, metadata: { deliveryProfileId: profileId } });
}

/** Explicit reapplication deliberately replaces this episode's snapshot and is always audited. */
export async function applyActiveDeliveryProfileToEpisode(episodeId: string, payload: unknown) {
  const parsed = applyDeliveryProfileSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery profile application.");
  const context = await requireDeliveryCapability("manage_episode_manifests", "Your role needs the Manage episode manifests permission.");
  const episode = await getEpisodeScope(context.organizationId, episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found in this post house.");
  const profile = await getDeliveryProfileScope(context.organizationId, parsed.data.deliveryProfileId);
  if (!profile || !profile.isActive) throw new DeliveryManifestError(404, "Active delivery profile not found in this post house.");
  assertProfileAppliesToEpisode(profile, episode);
  const result = await copyProfileSnapshot({ organizationId: context.organizationId, episode, profile, appliedByUserId: context.userId });
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: result.replacedExisting ? "episode_delivery_manifest.reapplied" : "episode_delivery_manifest.applied", entityType: "episode_delivery_manifest", entityId: result.id, metadata: { episodeId, deliveryProfileId: profile.id, reason: parsed.data.reason, itemCount: result.itemCount } });
  return getEpisodeDeliveryManifestForOrganization(context.organizationId, episodeId);
}

/** Called from the episode creation path. It never overwrites an existing manifest. */
export async function createDeliveryManifestForNewEpisode(input: { organizationId: string; episodeId: string; appliedByUserId?: string | null }) {
  const episode = await getEpisodeScope(input.organizationId, input.episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found in this post house.");
  const [existing] = await getDb().select({ id: episodeDeliveryManifests.id }).from(episodeDeliveryManifests)
    .where(and(eq(episodeDeliveryManifests.organizationId, input.organizationId), eq(episodeDeliveryManifests.episodeId, input.episodeId))).limit(1);
  if (existing) return existing.id;
  const [show] = await getDb().select({ deliveryProfileId: shows.deliveryProfileId }).from(shows)
    .where(and(eq(shows.id, episode.showId), eq(shows.organizationId, input.organizationId))).limit(1);
  if (!show?.deliveryProfileId) return null;
  const profile = await getDeliveryProfileScope(input.organizationId, show.deliveryProfileId);
  if (!profile) return null;
  assertProfileAppliesToEpisode(profile, episode);
  const result = await copyProfileSnapshot({ organizationId: input.organizationId, episode, profile, appliedByUserId: input.appliedByUserId ?? null });
  await writeAuditEvent({ organizationId: input.organizationId, actorUserId: input.appliedByUserId ?? null, action: "episode_delivery_manifest.generated", entityType: "episode_delivery_manifest", entityId: result.id, metadata: { episodeId: input.episodeId, deliveryProfileId: profile.id, itemCount: result.itemCount } });
  return result.id;
}

export async function addActiveEpisodeDeliveryItem(episodeId: string, payload: unknown) {
  const parsed = addEpisodeDeliveryItemSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery item.");
  const context = await requireDeliveryCapability("manage_episode_manifests", "Your role needs the Manage episode manifests permission.");
  const episode = await getEpisodeScope(context.organizationId, episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found in this post house.");
  const [manifest] = await getDb().select({ id: episodeDeliveryManifests.id }).from(episodeDeliveryManifests)
    .where(and(eq(episodeDeliveryManifests.organizationId, context.organizationId), eq(episodeDeliveryManifests.episodeId, episodeId))).limit(1);
  if (!manifest) throw new DeliveryManifestError(404, "Delivery manifest not found for this episode.");
  const [contact, positionRows] = await Promise.all([
    getEligibleDeliveryRecipientSnapshot(context.organizationId, episode, parsed.data.recipientContactId),
    getDb().select({ position: max(episodeDeliveryItems.position) }).from(episodeDeliveryItems)
      .where(and(eq(episodeDeliveryItems.organizationId, context.organizationId), eq(episodeDeliveryItems.episodeDeliveryManifestId, manifest.id))),
  ]);
  const positionResult = positionRows[0];
  const { reason, ...itemData } = parsed.data;
  const [item] = await getDb().insert(episodeDeliveryItems).values({
    ...itemData,
    organizationId: context.organizationId,
    episodeDeliveryManifestId: manifest.id,
    episodeId,
    recipientName: contact?.name ?? null,
    recipientEmail: contact?.email ?? null,
    dueDate: toDate(parsed.data.dueDate),
    status: "not_started",
    qcResult: parsed.data.qcRequired ? "not_started" : "not_required",
    position: Number(positionResult?.position ?? 0) + 1,
  }).returning({ id: episodeDeliveryItems.id });
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_item.added", entityType: "episode_delivery_item", entityId: item.id, metadata: { episodeId, reason } });
  return item;
}

export async function updateActiveEpisodeDeliveryItem(episodeId: string, itemId: string, payload: unknown) {
  const parsed = updateEpisodeDeliveryItemSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery item.");
  const context = await requireDeliveryCapability("update_delivery_items", "Your role needs the Update delivery items permission.");
  const episode = await getEpisodeScope(context.organizationId, episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found in this post house.");
  const [item] = await getDb().select({
    id: episodeDeliveryItems.id,
    label: episodeDeliveryItems.label,
    dueDate: episodeDeliveryItems.dueDate,
    recipientContactId: episodeDeliveryItems.recipientContactId,
    status: episodeDeliveryItems.status,
    required: episodeDeliveryItems.required,
  }).from(episodeDeliveryItems)
    .where(and(eq(episodeDeliveryItems.id, itemId), eq(episodeDeliveryItems.episodeId, episodeId), eq(episodeDeliveryItems.organizationId, context.organizationId))).limit(1);
  if (!item) throw new DeliveryManifestError(404, "Delivery item not found.");
  const { reason, dueDate, recipientContactId, ...changes } = parsed.data;
  const contact = recipientContactId === undefined ? undefined : await getEligibleDeliveryRecipientSnapshot(context.organizationId, episode, recipientContactId);
  await getDb().update(episodeDeliveryItems).set({
    ...changes,
    ...(dueDate === undefined ? {} : { dueDate: toDate(dueDate) }),
    ...(recipientContactId === undefined ? {} : { recipientContactId, recipientName: contact?.name ?? null, recipientEmail: contact?.email ?? null }),
    updatedAt: new Date(),
  }).where(and(eq(episodeDeliveryItems.id, itemId), eq(episodeDeliveryItems.episodeId, episodeId), eq(episodeDeliveryItems.organizationId, context.organizationId)));
  const currentDueDate = toDate(item.dueDate);
  const nextDueDate = dueDate === undefined ? currentDueDate : toDate(dueDate);
  const nextRecipientContactId = recipientContactId === undefined ? item.recipientContactId : recipientContactId;
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_item.changed", entityType: "episode_delivery_item", entityId: itemId, metadata: { episodeId, reason, changedFields: Object.keys(parsed.data).filter((key) => key !== "reason") } });
  if (dueDate !== undefined && nextDueDate !== currentDueDate) {
    const manifest = await getEpisodeDeliveryManifestForOrganization(context.organizationId, episodeId);
    const audience = await getDeliveryNotificationAudience({ organizationId: context.organizationId, episodeId, contactIds: [nextRecipientContactId], excludePersonId: context.personId });
    const metadata = { episodeId, reason, fromDueDate: currentDueDate, toDueDate: nextDueDate };
    await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_item.due_date_changed", entityType: "episode_delivery_item", entityId: itemId, metadata });
    if (manifest && item.required && !["receipt_confirmed", "waived"].includes(item.status) && manifest.readiness.deadlineRisk !== "on_track") {
      await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_item.deadline_risk", entityType: "episode_delivery_item", entityId: itemId, metadata: { ...metadata, risk: manifest.readiness.deadlineRisk, ...deliveryNotificationMetadata(audience, "Delivery deadline at risk", `${item.label} is ${manifest.readiness.deadlineRisk.replaceAll("_", " ")} and still needs delivery action.`) } });
    }
  }
}

/**
 * The local exception is a controlled substitute for recipient confirmation,
 * never a way around delivery readiness, QC, or a recorded rejection.
 */
export async function authorizeActiveDeliveryAcceptanceException(episodeId: string, payload: unknown) {
  const parsed = authorizeDeliveryAcceptanceExceptionSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the local acceptance exception.");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) throw new DeliveryManifestError(401, "No active post house.");
  if (!(await can("authorize_delivery_exceptions"))) throw new DeliveryManifestError(403, "Your role is not authorised to record local delivery acceptance exceptions.");
  const organizationId = context.organization.organizationId;
  const episode = await getEpisodeScope(organizationId, episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found.");
  const [stage] = await getDb().select({ id: workflowStages.id, deliveryGate: workflowStages.deliveryGate })
    .from(workflowStages)
    .innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
    .where(and(
      eq(workflowStages.id, parsed.data.workflowStageId),
      eq(workflowStages.organizationId, organizationId),
      eq(postWorkflows.organizationId, organizationId),
    )).limit(1);
  if (!stage || stage.deliveryGate !== "client_acceptance") throw new DeliveryManifestError(409, "Choose the configured client/network acceptance stage.");
  const readiness = await getDeliveryWorkflowGateReadiness({ organizationId, episodeId, workflowStageId: stage.id, deliveryGate: "client_acceptance" });
  if (!readiness.facilityReady) throw new DeliveryManifestError(409, readiness.message ?? "Required delivery items are not ready for acceptance.");
  if (readiness.clientReceiptComplete) throw new DeliveryManifestError(409, "Every required item already has recipient receipt confirmation.");
  const now = new Date();
  const [exception] = await getDb().insert(episodeDeliveryAcceptanceExceptions).values({
    organizationId,
    episodeId,
    workflowStageId: stage.id,
    reason: parsed.data.reason,
    authorisedByUserId: context.userId,
    authorisedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [episodeDeliveryAcceptanceExceptions.episodeId, episodeDeliveryAcceptanceExceptions.workflowStageId],
    set: { reason: parsed.data.reason, authorisedByUserId: context.userId, authorisedAt: now, updatedAt: now },
  }).returning({ id: episodeDeliveryAcceptanceExceptions.id });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "episode_delivery_acceptance_exception.authorized", entityType: "episode_delivery_acceptance_exception", entityId: exception.id, metadata: { episodeId, workflowStageId: stage.id, reason: parsed.data.reason } });
  return exception;
}

/**
 * Lifecycle transitions are kept separate from general item edits so no caller
 * can jump directly to dispatched/accepted or overwrite a recorded QC result.
 */
export async function transitionActiveEpisodeDeliveryItem(episodeId: string, itemId: string, payload: unknown) {
  const parsed = transitionEpisodeDeliveryItemSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery lifecycle update.");
  const context = await requireDeliveryCapability(parsed.data.status === "receipt_confirmed" ? "confirm_delivery_receipt" : "update_delivery_items", parsed.data.status === "receipt_confirmed" ? "Your role needs the Confirm delivery receipt permission." : "Your role needs the Update delivery items permission.");
  const [item] = await getDb().select({
    id: episodeDeliveryItems.id,
    label: episodeDeliveryItems.label,
    status: episodeDeliveryItems.status,
    qcRequired: episodeDeliveryItems.qcRequired,
    qcResult: episodeDeliveryItems.qcResult,
    recipientContactId: episodeDeliveryItems.recipientContactId,
    requiresExternalRecipient: episodeDeliveryItems.requiresExternalRecipient,
    externalUrl: episodeDeliveryItems.externalUrl,
    externalReference: episodeDeliveryItems.externalReference,
  }).from(episodeDeliveryItems).where(and(
    eq(episodeDeliveryItems.id, itemId),
    eq(episodeDeliveryItems.episodeId, episodeId),
    eq(episodeDeliveryItems.organizationId, context.organizationId),
  )).limit(1);
  if (!item) throw new DeliveryManifestError(404, "Delivery item not found.");
  const episode = await getEpisodeScope(context.organizationId, episodeId);
  if (!episode) throw new DeliveryManifestError(404, "Episode not found in this post house.");

  const canWaive = await can("waive_qc");
  if (parsed.data.status === "waived" && !canWaive) {
    throw new DeliveryManifestError(403, "Your role needs the Waive QC permission to waive a delivery requirement.");
  }
  const nextExternalUrl = parsed.data.externalUrl === undefined ? item.externalUrl : parsed.data.externalUrl;
  const nextExternalReference = parsed.data.externalReference === undefined ? item.externalReference : parsed.data.externalReference;
  const validationError = validateDeliveryItemTransition({
    currentStatus: item.status,
    nextStatus: parsed.data.status,
    qcRequired: item.qcRequired,
    hasExternalEvidence: Boolean(nextExternalUrl || nextExternalReference),
    hasReason: Boolean(parsed.data.reason.trim()),
    canWaive,
    canRecordRejection: true,
  });
  if (validationError) throw new DeliveryManifestError(409, validationError);

  const now = new Date();
  const nextStatus = parsed.data.status;
  const dispatchRecipient = nextStatus === "dispatched"
    ? await getEligibleDeliveryRecipientSnapshot(context.organizationId, episode, item.recipientContactId)
    : null;
  if (nextStatus === "dispatched" && item.requiresExternalRecipient && !dispatchRecipient) {
    throw new DeliveryManifestError(409, "This required delivery item needs an eligible external recipient before dispatch.");
  }
  await getDb().update(episodeDeliveryItems).set({
    status: nextStatus,
    ...(parsed.data.externalUrl === undefined ? {} : { externalUrl: parsed.data.externalUrl }),
    ...(parsed.data.externalReference === undefined ? {} : { externalReference: parsed.data.externalReference }),
    ...(parsed.data.submissionMethod === undefined ? {} : { submissionMethod: parsed.data.submissionMethod }),
    ...(nextStatus === "ready_for_qc" ? { qcResult: item.qcRequired ? "not_started" : "not_required" } : {}),
    ...(nextStatus === "qc_failed" ? { qcResult: "failed" } : {}),
    ...(nextStatus === "qc_passed" ? { qcResult: "passed" } : {}),
    ...(nextStatus === "dispatched" ? { submittedAt: now, submittedByPersonId: context.personId, recipientName: dispatchRecipient?.name ?? null, recipientEmail: dispatchRecipient?.email ?? null, recipientSnapshotAt: dispatchRecipient ? now : null } : {}),
    ...(nextStatus === "receipt_confirmed" ? { receiptConfirmedAt: now, receiptConfirmedBy: parsed.data.receiptConfirmedBy ?? "Recipient confirmation recorded" } : {}),
    ...(nextStatus === "rejected" ? { rejectionReason: parsed.data.reason } : {}),
    ...(nextStatus === "waived" ? { waiverReason: parsed.data.reason, qcResult: item.qcRequired ? "waived" : item.qcResult } : {}),
    updatedAt: now,
  }).where(and(eq(episodeDeliveryItems.id, itemId), eq(episodeDeliveryItems.episodeId, episodeId), eq(episodeDeliveryItems.organizationId, context.organizationId)));
  let correctionWorkOrderId: string | null = null;
  if (nextStatus === "qc_failed" || nextStatus === "rejected") {
    const correctionGate = nextStatus === "qc_failed" ? "facility_dispatch" : "client_acceptance";
    const [gateStage] = await getDb().select({ id: workflowStages.id }).from(workflowStages)
      .innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(
        eq(workflowStages.organizationId, context.organizationId),
        eq(postWorkflows.organizationId, context.organizationId),
        eq(workflowStages.deliveryGate, correctionGate),
      )).limit(1);
    const [existing] = await getDb().select({ id: postWorkOrders.id }).from(postWorkOrders).where(and(
      eq(postWorkOrders.organizationId, context.organizationId),
      eq(postWorkOrders.episodeId, episodeId),
      eq(postWorkOrders.deliveryItemId, itemId),
      eq(postWorkOrders.kind, "delivery_correction"),
      notInArray(postWorkOrders.status, ["complete", "cancelled"]),
    )).limit(1);
    correctionWorkOrderId = existing?.id ?? null;
    if (!correctionWorkOrderId) {
      const [correction] = await getDb().insert(postWorkOrders).values({
        organizationId: context.organizationId,
        episodeId,
        workflowStageId: gateStage?.id ?? null,
        deliveryItemId: itemId,
        kind: "delivery_correction",
        title: `Delivery correction — ${item.label}`,
        description: parsed.data.reason,
        department: nextStatus === "qc_failed" ? "QC / delivery" : "Delivery",
        priority: "blocker",
        isBlocking: true,
        status: "open",
        externalUrl: nextExternalUrl,
        createdByUserId: context.userId,
      }).returning({ id: postWorkOrders.id });
      correctionWorkOrderId = correction.id;
      await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "delivery_correction_work_order.created", entityType: "post_work_order", entityId: correction.id, metadata: { episodeId, deliveryItemId: itemId, trigger: nextStatus, workflowStageId: gateStage?.id ?? null } });
    }
  }
  const action = nextStatus === "ready_for_qc"
    ? "episode_delivery_item.submitted"
    : ["qc_failed", "qc_passed"].includes(nextStatus)
      ? "episode_delivery_item.qc_result"
      : `episode_delivery_item.${nextStatus}`;
  const audience = (nextStatus === "dispatched" || nextStatus === "rejected")
    ? await getDeliveryNotificationAudience({ organizationId: context.organizationId, episodeId, contactIds: [item.recipientContactId], excludePersonId: context.personId })
    : null;
  const notification = nextStatus === "dispatched" && audience
    ? deliveryNotificationMetadata(audience, "Delivery dispatched — receipt requested", `${item.label} was dispatched and is awaiting recipient receipt confirmation.`)
    : nextStatus === "rejected" && audience
      ? deliveryNotificationMetadata(audience, "Delivery rejected", `${item.label} was rejected and needs corrective action.`)
      : {};
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action, entityType: "episode_delivery_item", entityId: itemId, metadata: { episodeId, fromStatus: item.status, toStatus: nextStatus, reason: parsed.data.reason, correctionWorkOrderId, ...notification } });
  return getEpisodeDeliveryManifestForOrganization(context.organizationId, episodeId);
}

export async function removeActiveEpisodeDeliveryItem(episodeId: string, itemId: string, payload: unknown) {
  const parsed = removeEpisodeDeliveryItemSchema.safeParse(payload);
  if (!parsed.success) throw new DeliveryManifestError(400, parsed.error.issues[0]?.message ?? "Check the delivery item removal.");
  const context = await requireDeliveryCapability("manage_episode_manifests", "Your role needs the Manage episode manifests permission.");
  const [item] = await getDb().delete(episodeDeliveryItems)
    .where(and(eq(episodeDeliveryItems.id, itemId), eq(episodeDeliveryItems.episodeId, episodeId), eq(episodeDeliveryItems.organizationId, context.organizationId)))
    .returning({ id: episodeDeliveryItems.id });
  if (!item) throw new DeliveryManifestError(404, "Delivery item not found.");
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "episode_delivery_item.removed", entityType: "episode_delivery_item", entityId: itemId, metadata: { episodeId, reason: parsed.data.reason } });
}
