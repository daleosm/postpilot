"use client";

import { Button } from "@heroui/react";
import { CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";

export type WorkOrderInboxItem = {
  id: string;
  episodeId: string;
  showId: string;
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number;
  workflowStageName: string | null;
  kind: string;
  title: string;
  description: string | null;
  priority: string;
  isBlocking: boolean;
  status: string;
  dueAt: Date | string | null;
  externalUrl: string | null;
  workflowState?: { displayStatus: string; primaryStageName: string | null } | null;
};

export function WorkOrderQueue({ workOrders, canOpenEpisodes }: { workOrders: WorkOrderInboxItem[]; canOpenEpisodes: boolean }) {
  return <section className="panel overflow-hidden"><div className="border-b border-[#ebeae6] px-5 py-4"><h2 className="text-sm font-semibold text-[#343b38]">My assigned work</h2><p className="mt-1 text-xs text-[#858a87]">Open post work orders and QC exceptions assigned to you or your role.</p></div><div className="divide-y divide-[#efeeea]">{workOrders.map((item) => <WorkOrderRow key={item.id} item={item} canOpenEpisodes={canOpenEpisodes} />)}{!workOrders.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No open work orders are assigned to you.</p>}</div></section>;
}

function WorkOrderRow({ item, canOpenEpisodes }: { item: WorkOrderInboxItem; canOpenEpisodes: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function complete() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/work-orders/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: item.kind === "qc_exception" ? "ready_for_review" : "complete" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) setMessage(body?.error ?? "Could not complete this work order.");
      else { setMessage(item.kind === "qc_exception" ? "QC exception handed to QC for re-check." : "Work order completed."); router.refresh(); }
    } catch { setMessage("Could not complete this work order."); }
    finally { setSaving(false); }
  }
  return <article className="px-5 py-4"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div className="min-w-0"><p className="text-xs font-medium text-[#617b75]">{item.showTitle} · E{String(item.episodeNumber).padStart(2, "0")} {item.episodeTitle}</p><div className="mt-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[#3c4440]">{item.title}</h3>{item.isBlocking && <span className="inline-flex items-center gap-1 rounded-full bg-[#f8e8df] px-2 py-0.5 text-[10px] font-semibold text-[#a15e42]"><ShieldAlert size={11} /> Blocker</span>}<span className="rounded-full bg-[#edf0ed] px-2 py-0.5 text-[10px] font-semibold text-[#65716c]">{item.priority}</span>{item.workflowState && <WorkflowStateBadge status={item.workflowState.displayStatus} />}</div><p className="mt-1 text-xs text-[#6e7772]">{item.workflowStageName ?? item.workflowState?.primaryStageName ?? "Episode work"}{item.dueAt ? ` · Due ${formatDate(item.dueAt)}` : ""}</p>{item.description && <p className="mt-2 text-xs leading-5 text-[#68716d]">{item.description}</p>}<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{canOpenEpisodes && <Link href={`/episodes/${item.episodeId}`} className="font-medium text-[#54776d] hover:underline">Open episode</Link>}{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#54776d] hover:underline"><ExternalLink size={12} /> External reference</a>}</div></div><Button variant="primary" onClick={complete} isDisabled={saving} className="button--success"><CheckCircle2 size={15} /> {saving ? "Saving…" : item.kind === "qc_exception" ? "Ready for re-QC" : "Mark complete"}</Button></div>{message && <p role="status" className={`mt-3 text-xs ${message.includes("completed") || message.includes("handed") ? "text-[#3f7563]" : "text-[#a35e41]"}`}>{message}</p>}</article>;
}

function formatDate(value: Date | string) { return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(value)); }
