import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { rooms } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { insertRoomSchema } from "@/lib/validations/entities";

const roomRequestSchema = insertRoomSchema.omit({ organizationId: true });

/** Create a room only inside the active tenant; organizationId is never client supplied. */
export async function POST(request: Request) {
  if (!(await can("manage_bookings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = roomRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the room details and try again." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-room", debug: true }, { status: 201 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [room] = await getDb().insert(rooms).values({ ...parsed.data, organizationId: context.organization.organizationId }).returning({ id: rooms.id });
    return NextResponse.json(room, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A room with that name already exists in this post house." }, { status: 409 });
  }
}
