"use client";

import { Button } from "@heroui/react";
import { CircleDollarSign } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postpilotApiFetch } from "@/lib/postpilot-api-client";

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

export function WorkOrderChargeQueue({ charges }: { charges: Charge[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [postingId, setPostingId] = useState<string | null>(null);
  const pending = charges.filter((charge) => charge.billingStatus === "draft");
  if (!pending.length) return null;

  async function post(charge: Charge) {
    setMessage(""); setPostingId(charge.id);
    try {
      // FastAPI derives the billable amount and Client PO from the approved
      // work order. The browser must never be able to alter either at post.
      await postpilotApiFetch(`/billing/work-orders/${charge.id}/billables`, { method: "POST", body: {} });
      setMessage("Client charge posted to the episode budget. It has not been invoiced.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not post this client charge.");
    } finally {
      setPostingId(null);
    }
  }

  return <section className="panel overflow-hidden">
    <div className="border-b border-[#ebeae6] px-5 py-4"><div className="flex items-center gap-2 text-sm font-semibold text-[#353b39]"><CircleDollarSign size={16} className="text-[#59756c]" /> Work-order charges</div><p className="mt-1 text-xs text-[#737b77]">A user with Budget permission can post a completed client change to the episode budget. Posting here does not create an invoice.</p></div>
    <div className="divide-y divide-[#efeeea]">{pending.map((charge) => {
      const canPost = charge.status === "complete" && charge.billingStatus === "draft";
      const proposed = String(charge.estimatedAmount ?? "");
    return <div key={charge.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_132px_220px_140px] lg:items-end"><div className="min-w-0"><p className="text-sm font-medium text-[#39423e]">{charge.title}</p><p className="mt-1 text-xs text-[#6e7672]">{charge.showTitle} · E{String(charge.episodeNumber).padStart(2, "0")} {charge.episodeTitle} · {charge.billingStatus.replaceAll("_", " ")}</p>{charge.billingNotes && <p className="mt-1 text-xs text-[#858a87]">{charge.billingNotes}</p>}</div><label className="text-xs font-medium text-[#59625e]">Charge total ({charge.currency})<input aria-label={`Charge total for ${charge.title}`} type="number" value={proposed} disabled className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-2 text-sm disabled:cursor-not-allowed disabled:text-[#7b827e]" /></label><label className="text-xs font-medium text-[#59625e]">Client PO (optional)<select aria-label={`Client PO for ${charge.title}`} value="" disabled className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-2 text-sm disabled:cursor-not-allowed disabled:text-[#7b827e]"><option value="">Set on work order</option></select></label><Button variant="primary" isDisabled={!canPost || postingId === charge.id || !Number(proposed)} onPress={() => post(charge)} className="bg-[#476f61] text-white disabled:opacity-50">{postingId === charge.id ? "Posting…" : canPost ? "Post to budget" : "Awaiting completion"}</Button></div>;
    })}</div>
    {message && <p role="status" className={`px-5 py-3 text-xs ${message.includes("Could not") || message.includes("Complete") ? "text-[#a35e41]" : "text-[#4d8068]"}`}>{message}</p>}
  </section>;
}
