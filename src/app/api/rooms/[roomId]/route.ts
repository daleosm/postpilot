import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { rooms } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { updateRoomSchema } from "@/lib/validations/entities";

/** Edit a room only when its ID belongs to the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  if (!(await can("manage_bookings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateRoomSchema.safeParse(await request.json());
  if (!parsed.success || !Object.keys(parsed.data).length) return NextResponse.json({ error: "Check the room details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debug: true });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  try {
    const [room] = await getDb().update(rooms).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(rooms.id, roomId), eq(rooms.organizationId, context.organization.organizationId)))
      .returning({ id: rooms.id });
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
    return NextResponse.json(room);
  } catch {
    return NextResponse.json({ error: "A room with that name already exists in this post house." }, { status: 409 });
  }
}
