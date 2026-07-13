import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { people, postWorkOrders } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getTenantRolePolicies } from "@/lib/permissions";
import { getTenantPurchaseOrder } from "@/lib/purchase-orders";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { updatePostWorkOrderSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  const parsed = updatePostWorkOrderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the work-order update." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { workOrderId } = await params;
  const db = getDb();
  const [workOrder, person] = await Promise.all([
    db.select().from(postWorkOrders).where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId))).limit(1),
    db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!workOrder[0]) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  const mayManage = await can("manage_work_orders");
  const mayManageCommercial = await can("manage_budget");
  const mayUpdateAssigned = await can("update_assigned_work");
  const mayVerifyQc = await can("verify_qc");
  const isAssigned = Boolean(person[0] && (workOrder[0].assigneePersonId === person[0].id || workOrder[0].assigneeRole === person[0].role));
  if (!mayManage && !(mayUpdateAssigned && isAssigned)) return NextResponse.json({ error: "You can only update work assigned to you." }, { status: 403 });
  const managerFields = ["title", "description", "department", "assigneePersonId", "assigneeRole", "vendorCompanyId", "purchaseOrderId", "priority", "isBlocking", "billingScope", "estimatedAmount", "currency", "billingNotes", "externalUrl", "dueAt"];
  if (!mayManage && managerFields.some((field) => field in parsed.data)) return NextResponse.json({ error: "Only post management can change work-order details or assignments." }, { status: 403 });
  if (!mayManage && parsed.data.status === "in_progress" && workOrder[0].status === "open") return NextResponse.json({ error: "A user with Work Orders permission must approve a draft before work begins." }, { status: 403 });
  const commercialFields = ["estimatedAmount", "currency", "billingNotes", "vendorCompanyId", "purchaseOrderId"];
  if (!mayManageCommercial && commercialFields.some((field) => field in parsed.data)) return NextResponse.json({ error: "Only users with the Budget permission can set commercial values." }, { status: 403 });
  if (workOrder[0].billingStatus === "posted" && ["billingScope", "estimatedAmount", "currency", "billingNotes"].some((field) => field in parsed.data)) return NextResponse.json({ error: "A charge already posted to budget cannot be changed here." }, { status: 409 });
  const missing = mayManage ? await missingTenantReferences(organizationId, { personId: parsed.data.assigneePersonId, companyId: parsed.data.vendorCompanyId }) : [];
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this post house.` }, { status: 404 });
  if (parsed.data.purchaseOrderId && !(await getTenantPurchaseOrder(organizationId, parsed.data.purchaseOrderId))) return NextResponse.json({ error: "Invalid purchase order for this post house." }, { status: 404 });
  const status = parsed.data.status;
  const nextStatus = status ?? workOrder[0].status;
  if (workOrder[0].kind === "qc_exception" && status === "complete" && !mayVerifyQc) return NextResponse.json({ error: "Your role needs the QC verification permission to close a QC exception. Mark it ready for re-QC instead." }, { status: 403 });
  const isComplete = nextStatus === "complete";
  const billingScope = parsed.data.billingScope ?? workOrder[0].billingScope;
  const billingStatus = billingScope !== "billable_change"
    ? "not_billable"
    : isComplete && workOrder[0].billingStatus === "draft"
      ? "awaiting_finance"
      : workOrder[0].billingStatus;
  const qcHandOff = workOrder[0].kind === "qc_exception" && status === "ready_for_review";
  const verificationRole = qcHandOff ? (await getTenantRolePolicies(organizationId)).find((policy) => policy.permissions.includes("verify_qc"))?.role : null;
  if (qcHandOff && !verificationRole) return NextResponse.json({ error: "Configure a role with QC verification before sending this exception to re-QC." }, { status: 409 });
  const { estimatedAmount, ...workOrderUpdate } = parsed.data;
  const completionChanged = status !== undefined;
  await db.update(postWorkOrders).set({ ...workOrderUpdate, estimatedAmount: estimatedAmount === undefined || estimatedAmount === null ? estimatedAmount : String(estimatedAmount), billingStatus, assigneePersonId: qcHandOff ? null : parsed.data.assigneePersonId, assigneeRole: qcHandOff ? verificationRole : parsed.data.assigneeRole, completedByPersonId: completionChanged ? (isComplete ? person[0]?.id ?? null : null) : workOrder[0].completedByPersonId, completedAt: completionChanged ? (isComplete ? new Date() : null) : workOrder[0].completedAt, updatedAt: new Date() }).where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: isComplete ? "work_order.completed" : "work_order.updated", entityType: "post_work_order", entityId: workOrderId, metadata: { episodeId: workOrder[0].episodeId, status: status ?? workOrder[0].status, billingStatus } });
  return NextResponse.json({ ok: true });
}
