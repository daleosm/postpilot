import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reviewNotes } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getCurrentPerson, isExternalReviewerRole } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getReviewCutWorkspace } from "@/server/data";
import { clientCanAccess } from "@/lib/client-access";
import { insertReviewNoteSchema } from "@/lib/validations/entities";
export async function POST(request: Request) { if (!(await can("update_notes"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); if (isDebugDemoMode) return NextResponse.json({ id: "demo-new-note", debug: true }, { status: 201 }); const parsed = insertReviewNoteSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Check the note fields and try again." }, { status: 400 }); const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const workspace = await getReviewCutWorkspace(context.organization.organizationId, parsed.data.reviewCutId); if (!workspace) return NextResponse.json({ error: "Review cut not found." }, { status: 404 }); const person = await getCurrentPerson(); if (isExternalReviewerRole(person?.role) && !(await clientCanAccess({ organizationId: context.organization.organizationId, userId: context.userId, showId: workspace.cut.showId, episodeId: workspace.cut.episodeId, reviewCutId: workspace.cut.id }))) return NextResponse.json({ error: "This cut has not been shared with you." }, { status: 403 }); const [note] = await getDb().insert(reviewNotes).values({ ...parsed.data, organizationId: context.organization.organizationId, authorUserId: context.userId, authorName: parsed.data.authorName ?? "PostPilot user", timecodeSeconds: parsed.data.timecodeSeconds ? String(parsed.data.timecodeSeconds) : null }).returning({ id: reviewNotes.id }); return NextResponse.json(note, { status: 201 }); }
