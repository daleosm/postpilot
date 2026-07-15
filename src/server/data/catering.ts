import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings, cateringRequests, people, rooms } from "@/lib/db/schema";

const requester = people;

export async function listCateringRequests(organizationId: string, requesterPersonId?: string) {
  const db = getDb();
  const rows = await db.select({
    id: cateringRequests.id, requestType: cateringRequests.requestType, item: cateringRequests.item, quantity: cateringRequests.quantity, notes: cateringRequests.notes, requestedFor: cateringRequests.requestedFor, status: cateringRequests.status, fulfilledAt: cateringRequests.fulfilledAt, actualCost: cateringRequests.actualCost, billedAmount: cateringRequests.billedAmount, markupPercent: cateringRequests.markupPercent, currency: cateringRequests.currency, receiptReference: cateringRequests.receiptReference, createdAt: cateringRequests.createdAt, requestedByPersonId: cateringRequests.requestedByPersonId,
    roomId: rooms.id, roomName: rooms.name, bookingId: bookings.id, requesterName: requester.name,
  }).from(cateringRequests)
    .leftJoin(rooms, and(eq(cateringRequests.roomId, rooms.id), eq(rooms.organizationId, organizationId)))
    .leftJoin(bookings, and(eq(cateringRequests.bookingId, bookings.id), eq(bookings.organizationId, organizationId)))
    .leftJoin(requester, and(eq(cateringRequests.requestedByPersonId, requester.id), eq(requester.organizationId, organizationId)))
    .where(eq(cateringRequests.organizationId, organizationId))
    .orderBy(asc(cateringRequests.status), asc(cateringRequests.requestedFor), asc(cateringRequests.createdAt));
  return requesterPersonId ? rows.filter((row) => row.requestedByPersonId === requesterPersonId) : rows;
}

export async function getCateringResources(organizationId: string) {
  const db = getDb();
  const now = new Date();
  const [roomRows, bookingRows] = await Promise.all([
    db.select({ id: rooms.id, name: rooms.name, type: rooms.type }).from(rooms).where(eq(rooms.organizationId, organizationId)).orderBy(asc(rooms.name)),
    db.select({ id: bookings.id, roomName: rooms.name })
      .from(bookings).innerJoin(rooms, and(eq(bookings.roomId, rooms.id), eq(rooms.organizationId, organizationId)))
      .where(and(eq(bookings.organizationId, organizationId), lte(bookings.startsAt, now), gte(bookings.endsAt, now))).orderBy(asc(rooms.name)),
  ]);
  return { rooms: roomRows, bookings: bookingRows };
}
