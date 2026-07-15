import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings, episodes, people, rooms } from "@/lib/db/schema";

type BookingWindow = { roomId?: string | null; personId?: string | null; startsAt: Date; endsAt: Date; setupMinutes?: number; handoverMinutes?: number; bookingType?: string; excludeId?: string };

const roomTypesForBooking: Record<string, string[]> = {
  edit: ["edit_bay"], color: ["color_suite"], mix: ["mix_room"], qc: ["qc_room"], client_review: ["edit_bay", "mix_room"], ingest: ["edit_bay"], conform: ["edit_bay", "color_suite"],
};
const rolesForBooking: Record<string, string[]> = {
  edit: ["editor", "assistant_editor"], color: ["colorist"], mix: ["sound_mixer", "rerecording_mixer"], qc: ["qc"], client_review: ["producer", "post_supervisor"], ingest: ["assistant_editor"], conform: ["online_editor", "editor"],
};

export async function findBookingConflicts(organizationId: string, window: BookingWindow) {
  const operational = operationalWindow(window);
  const resources = [window.roomId ? eq(bookings.roomId, window.roomId) : undefined, window.personId ? eq(bookings.personId, window.personId) : undefined].filter(Boolean);
  if (!resources.length) return [];
  const conditions = [eq(bookings.organizationId, organizationId), ne(bookings.status, "cancelled"), or(...resources), sql`${bookings.startsAt} - (${bookings.setupMinutes} * interval '1 minute') < ${operational.endsAt.toISOString()}::timestamptz`, sql`${bookings.endsAt} + (${bookings.handoverMinutes} * interval '1 minute') > ${operational.startsAt.toISOString()}::timestamptz`];
  if (window.excludeId) conditions.push(ne(bookings.id, window.excludeId));

  const conflicts = await getDb().select({ id: bookings.id, title: bookings.title, startsAt: bookings.startsAt, endsAt: bookings.endsAt, setupMinutes: bookings.setupMinutes, handoverMinutes: bookings.handoverMinutes, bookingType: bookings.bookingType, roomId: bookings.roomId, personId: bookings.personId, roomName: rooms.name, personName: people.name, personAvailability: people.availability, personIsFreelancer: people.isFreelancer, episodeTitle: episodes.title })
    .from(bookings).leftJoin(rooms, eq(bookings.roomId, rooms.id)).leftJoin(people, eq(bookings.personId, people.id)).leftJoin(episodes, eq(bookings.episodeId, episodes.id)).where(and(...conditions));
  return conflicts.map((conflict) => ({ ...conflict, overlaps: [conflict.roomId && conflict.roomId === window.roomId ? "room" : null, conflict.personId && conflict.personId === window.personId ? "person" : null].filter((resource): resource is "room" | "person" => Boolean(resource)) }));
}

export async function getBookingSuggestions(organizationId: string, window: BookingWindow) {
  const db = getDb();
  const operational = operationalWindow(window);
  const conflicts = await findBookingConflicts(organizationId, window);
  const [selectedRoom, selectedPerson] = await Promise.all([
    window.roomId ? db.select({ type: rooms.type }).from(rooms).where(and(eq(rooms.id, window.roomId), eq(rooms.organizationId, organizationId))).limit(1) : [],
    window.personId ? db.select({ role: people.role }).from(people).where(and(eq(people.id, window.personId), eq(people.organizationId, organizationId))).limit(1) : [],
  ]);
  const compatibleTypes = selectedRoom[0]?.type ? [selectedRoom[0].type] : roomTypesForBooking[window.bookingType ?? ""] ?? [];
  const compatibleRoles = selectedPerson[0]?.role ? [selectedPerson[0].role] : rolesForBooking[window.bookingType ?? ""] ?? [];
  const [availableRooms, availablePeople, resourceBookings] = await Promise.all([
    compatibleTypes.length ? db.select({ id: rooms.id, name: rooms.name, type: rooms.type }).from(rooms).where(and(eq(rooms.organizationId, organizationId), inArray(rooms.type, compatibleTypes))).orderBy(asc(rooms.name)) : [],
    compatibleRoles.length ? db.select({ id: people.id, name: people.name, role: people.role, availability: people.availability, isFreelancer: people.isFreelancer }).from(people).where(and(eq(people.organizationId, organizationId), inArray(people.role, compatibleRoles), eq(people.isActive, true), inArray(people.availability, ["available", "limited"]))).orderBy(asc(people.name)) : [],
    (window.roomId || window.personId) ? db.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt, setupMinutes: bookings.setupMinutes, handoverMinutes: bookings.handoverMinutes }).from(bookings).where(and(eq(bookings.organizationId, organizationId), ne(bookings.status, "cancelled"), or(window.roomId ? eq(bookings.roomId, window.roomId) : undefined, window.personId ? eq(bookings.personId, window.personId) : undefined), sql`${bookings.endsAt} + (${bookings.handoverMinutes} * interval '1 minute') > ${operational.startsAt.toISOString()}::timestamptz`, window.excludeId ? ne(bookings.id, window.excludeId) : undefined)).orderBy(asc(bookings.startsAt)) : [],
  ]);
  const duration = operational.endsAt.getTime() - operational.startsAt.getTime();
  const alternativeResourceConditions = [availableRooms.length ? inArray(bookings.roomId, availableRooms.map((room) => room.id)) : undefined, availablePeople.length ? inArray(bookings.personId, availablePeople.map((person) => person.id)) : undefined].filter(Boolean);
  const busyAlternatives = alternativeResourceConditions.length ? await db.select({ roomId: bookings.roomId, personId: bookings.personId }).from(bookings)
    .where(and(eq(bookings.organizationId, organizationId), ne(bookings.status, "cancelled"), or(...alternativeResourceConditions), sql`${bookings.startsAt} - (${bookings.setupMinutes} * interval '1 minute') < ${operational.endsAt.toISOString()}::timestamptz`, sql`${bookings.endsAt} + (${bookings.handoverMinutes} * interval '1 minute') > ${operational.startsAt.toISOString()}::timestamptz`, window.excludeId ? ne(bookings.id, window.excludeId) : undefined)) : [];
  const busyRoomIds = new Set(busyAlternatives.flatMap((booking) => booking.roomId ? [booking.roomId] : []));
  const busyPersonIds = new Set(busyAlternatives.flatMap((booking) => booking.personId ? [booking.personId] : []));
  let nextStart = new Date(operational.startsAt);
  for (const booking of resourceBookings) {
    const nextEnd = new Date(nextStart.getTime() + duration);
    const occupiedStart = new Date(booking.startsAt.getTime() - booking.setupMinutes * 60_000);
    const occupiedEnd = new Date(booking.endsAt.getTime() + booking.handoverMinutes * 60_000);
    if (occupiedStart < nextEnd && occupiedEnd > nextStart) nextStart = occupiedEnd;
  }
  return {
    conflicts,
    availableRooms: availableRooms.filter((room) => room.id !== window.roomId && !busyRoomIds.has(room.id)).slice(0, 4),
    availablePeople: availablePeople.filter((person) => person.id !== window.personId && !busyPersonIds.has(person.id)).slice(0, 4),
    nearestSlot: resourceBookings.length ? { startsAt: new Date(nextStart.getTime() + (window.setupMinutes ?? 0) * 60_000), endsAt: new Date(nextStart.getTime() + duration - (window.handoverMinutes ?? 0) * 60_000) } : null,
  };
}

function operationalWindow(window: BookingWindow) {
  return {
    startsAt: new Date(window.startsAt.getTime() - (window.setupMinutes ?? 0) * 60_000),
    endsAt: new Date(window.endsAt.getTime() + (window.handoverMinutes ?? 0) * 60_000),
  };
}
