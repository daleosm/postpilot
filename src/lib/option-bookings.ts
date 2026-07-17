import "server-only";

import { and, asc, eq, ne, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";

export type OptionBookingScope = {
  roomId?: string | null;
  personId?: string | null;
  startsAt: Date;
  endsAt: Date;
  setupMinutes: number;
  handoverMinutes: number;
};

export function isActiveOptionBooking(booking: { isOption: boolean; status: string }) {
  return booking.isOption && booking.status !== "cancelled";
}

/**
 * Re-number only the pencil holds competing for this booking's room or person.
 * Creation time is deliberately the tie breaker: the default is first-come,
 * first-served, rather than moving a hold to the end when its timing is edited.
 */
export async function resequenceOptionBookings(organizationId: string, scope: OptionBookingScope) {
  const resources = [scope.roomId ? eq(bookings.roomId, scope.roomId) : undefined, scope.personId ? eq(bookings.personId, scope.personId) : undefined].filter(Boolean);
  if (!resources.length) return;

  const operationalStart = new Date(scope.startsAt.getTime() - scope.setupMinutes * 60_000).toISOString();
  const operationalEnd = new Date(scope.endsAt.getTime() + scope.handoverMinutes * 60_000).toISOString();
  const options = await getDb().select({ id: bookings.id }).from(bookings).where(and(
    eq(bookings.organizationId, organizationId),
    eq(bookings.isOption, true),
    ne(bookings.status, "cancelled"),
    or(...resources),
    sql`${bookings.startsAt} - (${bookings.setupMinutes} * interval '1 minute') < ${operationalEnd}::timestamptz`,
    sql`${bookings.endsAt} + (${bookings.handoverMinutes} * interval '1 minute') > ${operationalStart}::timestamptz`,
  )).orderBy(asc(bookings.createdAt), asc(bookings.id));

  await Promise.all(options.map((booking, index) => getDb().update(bookings).set({ optionRank: index + 1, updatedAt: new Date() })
    .where(and(eq(bookings.id, booking.id), eq(bookings.organizationId, organizationId)))));
}
