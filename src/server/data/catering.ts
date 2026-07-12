import "server-only";

import { and, asc, eq, gte } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings, cateringRequests, episodes, people, rooms } from "@/lib/db/schema";

const requester = people;

export async function listCateringRequests(organizationId: string, requesterPersonId?: string) {
  const db = getDb();
  const rows = await db.select({
    id: cateringRequests.id, requestType: cateringRequests.requestType, item: cateringRequests.item, quantity: cateringRequests.quantity, notes: cateringRequests.notes, requestedFor: cateringRequests.requestedFor, status: cateringRequests.status, fulfilledAt: cateringRequests.fulfilledAt, createdAt: cateringRequests.createdAt, requestedByPersonId: cateringRequests.requestedByPersonId,
    roomId: rooms.id, roomName: rooms.name, bookingId: bookings.id, bookingTitle: bookings.title, episodeTitle: episodes.title, requesterName: requester.name,
  }).from(cateringRequests)
    .leftJoin(rooms, and(eq(cateringRequests.roomId, rooms.id), eq(rooms.organizationId, organizationId)))
    .leftJoin(bookings, and(eq(cateringRequests.bookingId, bookings.id), eq(bookings.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(bookings.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .leftJoin(requester, and(eq(cateringRequests.requestedByPersonId, requester.id), eq(requester.organizationId, organizationId)))
    .where(eq(cateringRequests.organizationId, organizationId))
    .orderBy(asc(cateringRequests.status), asc(cateringRequests.requestedFor), asc(cateringRequests.createdAt));
  return requesterPersonId ? rows.filter((row) => row.requestedByPersonId === requesterPersonId) : rows;
}

export async function getCateringResources(organizationId: string) {
  const db = getDb();
  const [roomRows, bookingRows] = await Promise.all([
    db.select({ id: rooms.id, name: rooms.name, type: rooms.type }).from(rooms).where(eq(rooms.organizationId, organizationId)).orderBy(asc(rooms.name)),
    db.select({ id: bookings.id, title: bookings.title, roomId: bookings.roomId, roomName: rooms.name, startsAt: bookings.startsAt, episodeTitle: episodes.title })
      .from(bookings).leftJoin(rooms, and(eq(bookings.roomId, rooms.id), eq(rooms.organizationId, organizationId))).leftJoin(episodes, and(eq(bookings.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
      .where(and(eq(bookings.organizationId, organizationId), gte(bookings.endsAt, new Date(Date.now() - 12 * 60 * 60 * 1000)))).orderBy(asc(bookings.startsAt)),
  ]);
  return { rooms: roomRows, bookings: bookingRows };
}
