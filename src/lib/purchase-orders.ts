import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { billables, budgetLines, purchaseOrderEvents, purchaseOrders } from "@/lib/db/schema";

type PurchaseOrder = { id: string; kind: "vendor_commitment" | "client_authorisation"; amount: string | null; consumedAmount: string };

export async function getTenantPurchaseOrder(organizationId: string, purchaseOrderId: string) {
  const [purchaseOrder] = await getDb().select({ id: purchaseOrders.id, companyId: purchaseOrders.companyId, kind: purchaseOrders.kind, amount: purchaseOrders.amount, consumedAmount: purchaseOrders.consumedAmount, showId: purchaseOrders.showId, episodeId: purchaseOrders.episodeId, currency: purchaseOrders.currency, status: purchaseOrders.status })
    .from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.id, purchaseOrderId))).limit(1);
  return purchaseOrder ?? null;
}

async function sourceConsumed(organizationId: string, purchaseOrder: PurchaseOrder) {
  const db = getDb();
  if (purchaseOrder.kind === "client_authorisation") {
    const [result] = await db.select({ amount: sql<string>`coalesce(sum(${billables.amount}), 0)` }).from(billables)
      .where(and(eq(billables.organizationId, organizationId), eq(billables.purchaseOrderId, purchaseOrder.id), sql`${billables.status} <> 'void'`));
    return Number(result?.amount ?? 0);
  }
  const [result] = await db.select({ amount: sql<string>`coalesce(sum(${budgetLines.actualAmount}), 0)` }).from(budgetLines)
    .where(and(eq(budgetLines.organizationId, organizationId), eq(budgetLines.purchaseOrderId, purchaseOrder.id)));
  return Number(result?.amount ?? 0);
}

/** Recalculate the cached balance from the source ledger. Never trust a client-supplied consumed amount. */
export async function reconcilePurchaseOrder(organizationId: string, purchaseOrderId: string, input?: { actorUserId?: string; action?: string; amount?: number; metadata?: Record<string, unknown> }) {
  const purchaseOrder = await getTenantPurchaseOrder(organizationId, purchaseOrderId);
  if (!purchaseOrder) return null;
  const consumed = await sourceConsumed(organizationId, purchaseOrder);
  await getDb().update(purchaseOrders).set({ consumedAmount: String(consumed), updatedAt: new Date() }).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, organizationId)));
  if (input?.action) await getDb().insert(purchaseOrderEvents).values({ organizationId, purchaseOrderId, actorUserId: input.actorUserId ?? null, action: input.action, amount: input.amount === undefined ? null : String(input.amount), metadata: input.metadata ?? {} });
  return { ...purchaseOrder, consumedAmount: String(consumed), remainingAmount: Number(purchaseOrder.amount ?? 0) - consumed };
}

/** Blocks an overrun unless the tenant grants the explicit finance approval permission. */
export async function checkPurchaseOrderAllocation(organizationId: string, purchaseOrderId: string | null | undefined, amount: number, expectedKind: PurchaseOrder["kind"], mayApproveOverrun: boolean) {
  if (!purchaseOrderId) return { purchaseOrder: null, overrun: false };
  const purchaseOrder = await getTenantPurchaseOrder(organizationId, purchaseOrderId);
  if (!purchaseOrder) throw new Error("Purchase order not found for this post house.");
  if (purchaseOrder.kind !== expectedKind) throw new Error(expectedKind === "vendor_commitment" ? "Choose a vendor commitment PO for an internal cost." : "Choose a client authorisation PO for a client billable.");
  if (purchaseOrder.status !== "open") throw new Error("This purchase order is not open for new allocations.");
  const consumed = await sourceConsumed(organizationId, purchaseOrder);
  const approved = Number(purchaseOrder.amount ?? 0);
  const overrun = consumed + amount > approved;
  if (overrun && !mayApproveOverrun) throw new Error(`This allocation exceeds the remaining ${purchaseOrder.currency} ${(approved - consumed).toFixed(2)}. A user with PO-overrun approval must post it.`);
  return { purchaseOrder, overrun, remaining: approved - consumed };
}
