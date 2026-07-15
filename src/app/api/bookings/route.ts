import { NextResponse } from "next/server";

import { getBookingSuggestions } from "@/lib/booking-conflicts";
import { addGuestToEpisodeTeam, getGuestAccountForBooking } from "@/lib/booking-guests";
import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageBookings } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { bookingRequestSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await canManageBookings())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bookingRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the booking details and try again." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const missing = await missingTenantReferences(context.organization.organizationId, { roomId: parsed.data.roomId, episodeId: parsed.data.episodeId, personId: parsed.data.personId });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });
  const guest = parsed.data.guestPersonId ? await getGuestAccountForBooking(context.organization.organizationId, parsed.data.guestPersonId) : null;
  if (parsed.data.guestPersonId && !guest) return NextResponse.json({ error: "Guest account not found for this organization." }, { status: 404 });
  const availability = parsed.data.status === "cancelled" ? { conflicts: [] } : await getBookingSuggestions(context.organization.organizationId, parsed.data);
  if (availability.conflicts.length) return NextResponse.json({ error: "This room or artist already has a conflicting booking.", ...availability }, { status: 409 });
  const [booking] = await getDb().insert(bookings).values({ ...parsed.data, organizationId: context.organization.organizationId }).returning({ id: bookings.id });
  if (guest && parsed.data.episodeId) await addGuestToEpisodeTeam(context.organization.organizationId, parsed.data.episodeId, guest);
  return NextResponse.json(booking, { status: 201 });
}
