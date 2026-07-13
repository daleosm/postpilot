import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookingTimeSubmissions, bookings, crmContacts, episodes, people, rooms } from "@/lib/db/schema";
import { listEpisodes } from "./episodes";

export async function listSchedule(organizationId: string, from: Date, to: Date, personId?: string) {
  const db = getDb();
  return db.select({
    id: bookings.id, title: bookings.title, startsAt: bookings.startsAt, endsAt: bookings.endsAt, actualStartsAt: bookings.actualStartsAt, actualEndsAt: bookings.actualEndsAt, approvedOvertimeMinutes: bookings.approvedOvertimeMinutes, setupMinutes: bookings.setupMinutes, handoverMinutes: bookings.handoverMinutes, strikeMinutes: bookings.strikeMinutes, status: bookings.status, bookingType: bookings.bookingType,
    roomId: bookings.roomId, episodeId: bookings.episodeId, personId: bookings.personId, notes: bookings.notes,
    roomName: rooms.name, roomType: rooms.type, episodeTitle: episodes.title, episodeNumber: episodes.number, episodeProductionCode: episodes.productionCode, personName: people.name,
  }).from(bookings)
    .leftJoin(rooms, and(eq(bookings.roomId, rooms.id), eq(rooms.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(bookings.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .leftJoin(people, and(eq(bookings.personId, people.id), eq(people.organizationId, organizationId)))
    .where(and(eq(bookings.organizationId, organizationId), personId ? eq(bookings.personId, personId) : undefined, sql`${bookings.startsAt} - (${bookings.setupMinutes} * interval '1 minute') < ${to.toISOString()}::timestamptz`, sql`${bookings.endsAt} + ((${bookings.handoverMinutes} + ${bookings.strikeMinutes}) * interval '1 minute') > ${from.toISOString()}::timestamptz`))
    .orderBy(asc(bookings.startsAt));
}

export async function getScheduleResources(organizationId: string) {
  const db = getDb();
  const [roomRows, peopleRows, episodeRows, contacts] = await Promise.all([
    db.select({ id: rooms.id, name: rooms.name, type: rooms.type }).from(rooms).where(eq(rooms.organizationId, organizationId)).orderBy(asc(rooms.name)),
    db.select({ id: people.id, name: people.name, role: people.role, availability: people.availability, isFreelancer: people.isFreelancer }).from(people).where(eq(people.organizationId, organizationId)).orderBy(asc(people.name)),
    listEpisodes(organizationId),
    db.select({ id: crmContacts.id, name: crmContacts.name }).from(crmContacts).where(eq(crmContacts.organizationId, organizationId)).orderBy(asc(crmContacts.name)),
  ]);
  return { rooms: roomRows, people: peopleRows, contacts, episodes: episodeRows.map((episode) => ({ id: episode.id, label: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} ${episode.title}` })) };
}

export async function listPendingBookingTimeSubmissions(organizationId: string) {
  return getDb().select({ id: bookingTimeSubmissions.id, bookingTitle: bookings.title, personName: people.name, actualStartsAt: bookingTimeSubmissions.actualStartsAt, actualEndsAt: bookingTimeSubmissions.actualEndsAt, overtimeMinutes: bookingTimeSubmissions.overtimeMinutes, note: bookingTimeSubmissions.note })
    .from(bookingTimeSubmissions).innerJoin(bookings, and(eq(bookingTimeSubmissions.bookingId, bookings.id), eq(bookings.organizationId, organizationId))).innerJoin(people, and(eq(bookingTimeSubmissions.submittedByPersonId, people.id), eq(people.organizationId, organizationId)))
    .where(and(eq(bookingTimeSubmissions.organizationId, organizationId), eq(bookingTimeSubmissions.status, "pending"))).orderBy(asc(bookingTimeSubmissions.createdAt));
}

/** Tenant-owned room setup data. Kept separate from booking rows for Settings. */
export async function listRooms(organizationId: string) {
  const db = getDb();
  return db.select({
    id: rooms.id,
    name: rooms.name,
    type: rooms.type,
    location: rooms.location,
    capacity: rooms.capacity,
    notes: rooms.notes,
  }).from(rooms).where(eq(rooms.organizationId, organizationId)).orderBy(asc(rooms.name));
}
