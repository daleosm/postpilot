import { NextResponse } from "next/server";
import { z } from "zod";

import { getBookingSuggestions } from "@/lib/booking-conflicts";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageBookings } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { bookingRequestSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await canManageBookings())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  const parsed = bookingRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid booking window." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const excludeResult = z.string().uuid().optional().safeParse(body.excludeBookingId);
  if (!excludeResult.success) return NextResponse.json({ error: "Invalid booking reference." }, { status: 400 });
  const missing = await missingTenantReferences(context.organization.organizationId, {
    roomId: parsed.data.roomId,
    episodeId: parsed.data.episodeId,
    personId: parsed.data.personId,
    bookingId: excludeResult.data,
  });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });
  if (parsed.data.status === "cancelled") return NextResponse.json({ conflicts: [], availableRooms: [], availablePeople: [], nearestSlot: null });
  return NextResponse.json(await getBookingSuggestions(context.organization.organizationId, { ...parsed.data, excludeId: excludeResult.data }));
}
