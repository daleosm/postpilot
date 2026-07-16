"use client";

import { Button } from "@heroui/react";
import { CircleDollarSign } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClientPurchaseOrderSummary } from "@/server/data/client-purchase-orders";

type Charge = {
  id: string;
  title: string;
  department: string | null;
  status: string;
  billingStatus: string;
  estimatedAmount: string | number | null;
  currency: string;
  billingNotes: string | null;
  episodeTitle: string;
  episodeNumber: number;
  episodeId: string;
  showId: string;
  showTitle: string;
  clientCompanyId: string | null;
};

export function WorkOrderChargeQueue({ charges, clientPurchaseOrders }: { charges: Charge[]; clientPurchaseOrders: ClientPurchaseOrderSummary[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [purchaseOrderValues, setPurchaseOrderValues] = useState<Record<string, string>>({});
  const [overrunReasons, setOverrunReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [postingId, setPostingId] = useState<string | null>(null);
  const pending = charges.filter((charge) => charge.billingStatus === "draft");
  if (!pending.length) return null;

  async function post(charge: Charge) {
    const actualAmount = values[charge.id] ?? String(charge.estimatedAmount ?? "");
    setMessage(""); setPostingId(charge.id);
    const clientPurchaseOrderId = purchaseOrderValues[charge.id] || null;
    const response = await fetch(`/api/work-orders/${charge.id}/charge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualAmount, category: charge.department || "Post work order", clientPurchaseOrderId, clientPoOverrunReason: overrunReasons[charge.id] || null }) });
    const body = await response.json().catch(() => null);
    setPostingId(null);
    if (!response.ok) { setMessage(body?.error ?? "Could not post this client charge."); return; }
    setMessage("Client charge posted to the episode budget. It has not been invoiced."); router.refresh();
  }

  return <section className="panel overflow-hidden">
    <div className="border-b border-[#ebeae6] px-5 py-4"><div className="flex items-center gap-2 text-sm font-semibold text-[#353b39]"><CircleDollarSign size={16} className="text-[#59756c]" /> Work-order charges</div><p className="mt-1 text-xs text-[#737b77]">A user with Budget permission can post a completed client change to the episode budget. Posting here does not create an invoice.</p></div>
    <div className="divide-y divide-[#efeeea]">{pending.map((charge) => {
      const canPost = charge.status === "complete" && charge.billingStatus === "draft";
      const proposed = values[charge.id] ?? String(charge.estimatedAmount ?? "");
      const applicablePos = clientPurchaseOrders.filter((order) => order.status === "active" && order.clientCompanyId === charge.clientCompanyId && (!order.showId || order.showId === charge.showId) && (!order.episodeId || order.episodeId === charge.episodeId) && (!order.expiryDate || order.expiryDate >= new Date().toISOString().slice(0, 10)));
      const selectedPo = applicablePos.find((order) => order.id === purchaseOrderValues[charge.id]);
      const overrun = selectedPo ? Number(proposed || 0) - selectedPo.remainingAmount : 0;
      return <div key={charge.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_132px_220px_140px] lg:items-end"><div className="min-w-0"><p className="text-sm font-medium text-[#39423e]">{charge.title}</p><p className="mt-1 text-xs text-[#6e7672]">{charge.showTitle} · E{String(charge.episodeNumber).padStart(2, "0")} {charge.episodeTitle} · {charge.billingStatus.replaceAll("_", " ")}</p>{charge.billingNotes && <p className="mt-1 text-xs text-[#858a87]">{charge.billingNotes}</p>}</div><label className="text-xs font-medium text-[#59625e]">Charge total ({charge.currency})<input aria-label={`Charge total for ${charge.title}`} type="number" min="0.01" step="0.01" value={proposed} onChange={(event) => setValues((current) => ({ ...current, [charge.id]: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-2 text-sm" /></label><label className="text-xs font-medium text-[#59625e]">Client PO (optional)<select aria-label={`Client PO for ${charge.title}`} value={purchaseOrderValues[charge.id] ?? ""} onChange={(event) => setPurchaseOrderValues((current) => ({ ...current, [charge.id]: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-2 text-sm"><option value="">No client PO</option>{applicablePos.map((order) => <option key={order.id} value={order.id}>{order.poNumber} · {order.currency} {order.remainingAmount.toFixed(2)} remaining</option>)}</select>{selectedPo && <span className={`mt-1 block text-[11px] ${overrun > 0 ? "text-[#a35e41]" : "text-[#68746e]"}`}>{overrun > 0 ? `${selectedPo.currency} ${overrun.toFixed(2)} over remaining value` : `${selectedPo.currency} ${selectedPo.remainingAmount.toFixed(2)} remaining`}</span>}{overrun > 0 && <input aria-label={`Client PO overrun reason for ${charge.title}`} value={overrunReasons[charge.id] ?? ""} onChange={(event) => setOverrunReasons((current) => ({ ...current, [charge.id]: event.target.value }))} placeholder="Overrun reason" className="mt-1.5 h-9 w-full rounded-md border border-[#dfc7bc] bg-[#fffaf6] px-2 text-sm" />}</label><Button variant="primary" isDisabled={!canPost || postingId === charge.id || !Number(proposed)} onPress={() => post(charge)} className="bg-[#476f61] text-white disabled:opacity-50">{postingId === charge.id ? "Posting…" : canPost ? "Post to budget" : "Awaiting completion"}</Button></div>;
    })}</div>
    {message && <p role="status" className={`px-5 py-3 text-xs ${message.includes("Could not") || message.includes("Complete") ? "text-[#a35e41]" : "text-[#4d8068]"}`}>{message}</p>}
  </section>;
}
