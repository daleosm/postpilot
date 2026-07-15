import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { findBookingConflicts } from "@/lib/booking-conflicts";
import { getDb } from "@/lib/db";
import { bookings, episodes } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageBookings } from "@/lib/permissions";

const requestSchema = z.object({ sourceEpisodeId: z.string().uuid(), targetEpisodeId: z.string().uuid(), startsOn: z.coerce.date() }).refine((value) => value.sourceEpisodeId !== value.targetEpisodeId, { message: "Choose a different target episode.", path: ["targetEpisodeId"] });

/** Copies a source episode's room/person sequence as tentative bookings for another episode. */
export async function POST(request: Request) {
  if (!(await canManageBookings())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a source episode, target episode, and start date." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb(); const organizationId = context.organization.organizationId;
  const episodeRows = await db.select({ id: episodes.id, productionCode: episodes.productionCode }).from(episodes).where(and(eq(episodes.organizationId, organizationId), inArray(episodes.id, [parsed.data.sourceEpisodeId, parsed.data.targetEpisodeId])));
  const source = episodeRows.find((episode) => episode.id === parsed.data.sourceEpisodeId); const target = episodeRows.find((episode) => episode.id === parsed.data.targetEpisodeId);
  if (!source || !target) return NextResponse.json({ error: "Source or target episode was not found in this post house." }, { status: 404 });
  const sourceBookings = await db.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.episodeId, source.id), ne(bookings.status, "cancelled"))).orderBy(asc(bookings.startsAt));
  if (!sourceBookings.length) return NextResponse.json({ error: "The source episode has no bookings to copy." }, { status: 400 });
  const sourceDay = startOfDay(sourceBookings[0].startsAt); const targetDay = startOfDay(parsed.data.startsOn);
  const copies = sourceBookings.map((booking) => {
    const offset = booking.startsAt.getTime() - sourceDay.getTime();
    const duration = booking.endsAt.getTime() - booking.startsAt.getTime();
    const startsAt = new Date(targetDay.getTime() + offset); const endsAt = new Date(startsAt.getTime() + duration);
    return { organizationId, roomId: booking.roomId, personId: booking.personId, episodeId: target.id, title: source.productionCode && target.productionCode ? booking.title.replaceAll(source.productionCode, target.productionCode) : booking.title, startsAt, endsAt, setupMinutes: booking.setupMinutes, handoverMinutes: booking.handoverMinutes, strikeMinutes: booking.strikeMinutes, status: "tentative" as const, bookingType: booking.bookingType, notes: booking.notes };
  });
  const conflicts = (await Promise.all(copies.map((booking) => findBookingConflicts(organizationId, booking)))).flat();
  if (conflicts.length) return NextResponse.json({ error: "The copied sequence conflicts with existing room or personnel bookings.", conflicts }, { status: 409 });
  await db.insert(bookings).values(copies);
  return NextResponse.json({ created: copies.length }, { status: 201 });
}

function startOfDay(value: Date) { const day = new Date(value); day.setHours(0, 0, 0, 0); return day; }
