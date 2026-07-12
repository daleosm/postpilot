import "server-only";

import { and, asc, eq, gt, lt } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings, episodes, people, rooms } from "@/lib/db/schema";
import { listEpisodes } from "./episodes";

export async function listSchedule(organizationId: string, from: Date, to: Date) {
  const db = getDb();
  return db.select({
    id: bookings.id, title: bookings.title, startsAt: bookings.startsAt, endsAt: bookings.endsAt, status: bookings.status, bookingType: bookings.bookingType,
    roomId: bookings.roomId, episodeId: bookings.episodeId, personId: bookings.personId, notes: bookings.notes,
    roomName: rooms.name, roomType: rooms.type, episodeTitle: episodes.title, episodeNumber: episodes.number, personName: people.name,
  }).from(bookings)
    .leftJoin(rooms, and(eq(bookings.roomId, rooms.id), eq(rooms.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(bookings.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .leftJoin(people, and(eq(bookings.personId, people.id), eq(people.organizationId, organizationId)))
    .where(and(eq(bookings.organizationId, organizationId), lt(bookings.startsAt, to), gt(bookings.endsAt, from)))
    .orderBy(asc(bookings.startsAt));
}

export async function getScheduleResources(organizationId: string) {
  const db = getDb();
  const [roomRows, peopleRows, episodeRows] = await Promise.all([
    db.select({ id: rooms.id, name: rooms.name, type: rooms.type }).from(rooms).where(eq(rooms.organizationId, organizationId)).orderBy(asc(rooms.name)),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.organizationId, organizationId)).orderBy(asc(people.name)),
    listEpisodes(organizationId),
  ]);
  return { rooms: roomRows, people: peopleRows, episodes: episodeRows.map((episode) => ({ id: episode.id, label: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} ${episode.title}` })) };
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
