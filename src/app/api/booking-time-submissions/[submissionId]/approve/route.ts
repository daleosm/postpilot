import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { bookingTimeSubmissions, bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

export async function POST(_: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  if (!(await can("approve_time"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const organizationId = context.organization.organizationId;
  const { submissionId } = await params; const db = getDb();
  const [submission] = await db.select().from(bookingTimeSubmissions).where(and(eq(bookingTimeSubmissions.id, submissionId), eq(bookingTimeSubmissions.organizationId, organizationId), eq(bookingTimeSubmissions.status, "pending"))).limit(1);
  if (!submission) return NextResponse.json({ error: "Pending time submission not found." }, { status: 404 });
  await db.transaction(async (tx) => { await tx.update(bookingTimeSubmissions).set({ status: "approved", reviewedByPersonId: context.person?.id ?? null, reviewedAt: new Date() }).where(eq(bookingTimeSubmissions.id, submission.id)); await tx.update(bookings).set({ actualStartsAt: submission.actualStartsAt, actualEndsAt: submission.actualEndsAt, approvedOvertimeMinutes: submission.overtimeMinutes }).where(and(eq(bookings.id, submission.bookingId), eq(bookings.organizationId, organizationId))); });
  return NextResponse.json({ approved: true });
}
