import { and, eq, gt, lt, ne, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings, episodes, people, rooms } from "@/lib/db/schema";

type BookingWindow = { roomId?: string | null; personId?: string | null; startsAt: Date; endsAt: Date; excludeId?: string };

export async function findBookingConflicts(organizationId: string, window: BookingWindow) {
  const resources = [window.roomId ? eq(bookings.roomId, window.roomId) : undefined, window.personId ? eq(bookings.personId, window.personId) : undefined].filter(Boolean);
  if (!resources.length) return [];
  const conditions = [eq(bookings.organizationId, organizationId), ne(bookings.status, "cancelled"), or(...resources), lt(bookings.startsAt, window.endsAt), gt(bookings.endsAt, window.startsAt)];
  if (window.excludeId) conditions.push(ne(bookings.id, window.excludeId));

  return getDb().select({ id: bookings.id, title: bookings.title, startsAt: bookings.startsAt, endsAt: bookings.endsAt, roomName: rooms.name, personName: people.name, episodeTitle: episodes.title })
    .from(bookings).leftJoin(rooms, eq(bookings.roomId, rooms.id)).leftJoin(people, eq(bookings.personId, people.id)).leftJoin(episodes, eq(bookings.episodeId, episodes.id)).where(and(...conditions));
}
