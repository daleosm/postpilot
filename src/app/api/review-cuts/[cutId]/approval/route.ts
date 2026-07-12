import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { people, reviewCutApprovals, reviewCuts } from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { clientCanAccess } from "@/lib/client-access";
import { DEBUG_REVIEW_APPROVALS_COOKIE, parseDebugReviewApprovals } from "@/lib/debug-review-approvals";
import { getReviewCutWorkspace } from "@/server/data";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { reviewCutApprovalRequestSchema } from "@/lib/validations/entities";

export async function POST(request: Request, { params }: { params: Promise<{ cutId: string }> }) {
  if (!(await can("approve_reviews"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = reviewCutApprovalRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose an approval action." }, { status: 400 });
  const approved = parsed.data.action === "approve";
  if (isDebugDemoMode) {
    const { cutId } = await params;
    const storedApprovals = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEBUG_REVIEW_APPROVALS_COOKIE}=`))?.slice(DEBUG_REVIEW_APPROVALS_COOKIE.length + 1);
    const approvals = parseDebugReviewApprovals(storedApprovals);
    approvals[cutId] = approved ? "approved" : "changes_requested";
    const response = NextResponse.json({ ok: true, debug: true, approvalStatus: approvals[cutId] });
    response.cookies.set(DEBUG_REVIEW_APPROVALS_COOKIE, JSON.stringify(approvals), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  }
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { cutId } = await params;
  const workspace = await getReviewCutWorkspace(context.organization.organizationId, cutId);
  if (!workspace) return NextResponse.json({ error: "Review cut not found." }, { status: 404 });
  const db = getDb();
  const [actor] = await db.select({ id: people.id, role: people.role }).from(people)
    .where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1);
  const isPrivileged = ["producer", "post_supervisor"].includes(actor?.role ?? "");
  if (!isPrivileged && ["client", "director", "network"].includes(actor?.role ?? "") && !(await clientCanAccess({ organizationId: context.organization.organizationId, userId: context.userId, showId: workspace.cut.showId, reviewCutId: cutId, episodeId: workspace.cut.episodeId, requireApproval: true }))) {
    return NextResponse.json({ error: "This cut has not been shared with you for approval." }, { status: 403 });
  }
  if (!actor && !isPrivileged) return NextResponse.json({ error: "Your account is not configured as an approver." }, { status: 403 });
  await db.insert(reviewCutApprovals).values({ organizationId: context.organization.organizationId, reviewCutId: cutId, approverPersonId: actor?.id ?? null, approverRole: actor?.role ?? context.organization.role, decision: approved ? "approved" : "changes_requested", comment: parsed.data.comment ?? null });
  await db.update(reviewCuts).set({ status: approved ? "approved" : "changes_requested", approvalStatus: approved ? "approved" : "changes_requested", updatedAt: new Date() }).where(and(eq(reviewCuts.id, cutId), eq(reviewCuts.organizationId, context.organization.organizationId)));
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: approved ? "review_cut.approved" : "review_cut.changes_requested", entityType: "review_cut", entityId: cutId, metadata: { version: workspace.cut.version } });
  return NextResponse.json({ ok: true, approvalStatus: approved ? "approved" : "changes_requested" });
}
