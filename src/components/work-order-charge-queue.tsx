"use client";

import { Button } from "@heroui/react";
import { CircleDollarSign } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  showTitle: string;
};

export function WorkOrderChargeQueue({ charges }: { charges: Charge[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [postingId, setPostingId] = useState<string | null>(null);
  const pending = charges.filter((charge) => charge.billingStatus === "draft");
  if (!pending.length) return null;

  async function post(charge: Charge) {
    const actualAmount = values[charge.id] ?? String(charge.estimatedAmount ?? "");
    setMessage(""); setPostingId(charge.id);
    const response = await fetch(`/api/work-orders/${charge.id}/charge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualAmount, category: charge.department || "Post work order" }) });
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
      return <div key={charge.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_132px_140px] lg:items-end"><div className="min-w-0"><p className="text-sm font-medium text-[#39423e]">{charge.title}</p><p className="mt-1 text-xs text-[#6e7672]">{charge.showTitle} · E{String(charge.episodeNumber).padStart(2, "0")} {charge.episodeTitle} · {charge.billingStatus.replaceAll("_", " ")}</p>{charge.billingNotes && <p className="mt-1 text-xs text-[#858a87]">{charge.billingNotes}</p>}</div><label className="text-xs font-medium text-[#59625e]">Charge total ({charge.currency})<input aria-label={`Charge total for ${charge.title}`} type="number" min="0.01" step="0.01" value={proposed} onChange={(event) => setValues((current) => ({ ...current, [charge.id]: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-2 text-sm" /></label><Button variant="primary" isDisabled={!canPost || postingId === charge.id || !Number(proposed)} onPress={() => post(charge)} className="bg-[#476f61] text-white disabled:opacity-50">{postingId === charge.id ? "Posting…" : canPost ? "Post to budget" : "Awaiting completion"}</Button></div>;
    })}</div>
    {message && <p role="status" className={`px-5 py-3 text-xs ${message.includes("Could not") || message.includes("Complete") ? "text-[#a35e41]" : "text-[#4d8068]"}`}>{message}</p>}
  </section>;
}
