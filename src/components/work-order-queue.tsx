"use client";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

import { Button } from "@heroui/react";
import { CalendarPlus, CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";
import { OperationalRegister, StatusChip } from "@/components/operations-ui";

export type WorkOrderInboxItem = {
  id: string;
  episodeId: string;
  showId: string;
  bookingId: string | null;
  workType: string;
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
  return <OperationalRegister title="My assigned work" description="Open post work orders and QC exceptions assigned to you or your role." action={<StatusChip label={`${workOrders.length} open`} />} empty={{ title: "No open work orders are assigned to you.", description: "New assigned work will appear here with its episode, stage, due date, and next action." }}>{workOrders.length ? workOrders.map((item) => <WorkOrderRow key={item.id} item={item} canOpenEpisodes={canOpenEpisodes} />) : null}</OperationalRegister>;
}

function WorkOrderRow({ item, canOpenEpisodes }: { item: WorkOrderInboxItem; canOpenEpisodes: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function complete() {
    setSaving(true); setMessage("");
    try {
      const response = await postpilotUiFetch(`/v1/work-orders/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: item.kind === "qc_exception" ? "ready_for_review" : "complete" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) setMessage(body?.error ?? "Could not complete this work order.");
      else { setMessage(item.kind === "qc_exception" ? "QC exception handed to QC for re-check." : "Work order completed."); router.refresh(); }
    } catch { setMessage("Could not complete this work order."); }
    finally { setSaving(false); }
  }
  const needsBooking = item.workType === "internal" && !item.bookingId && ["in_progress", "ready_for_review"].includes(item.status);
  const canComplete = item.status === "in_progress" && !needsBooking;
  const action = needsBooking ? (
    <Button variant="primary" onPress={() => router.push(`/bookings?workOrder=${encodeURIComponent(item.id)}`)} className="button--success"><CalendarPlus size={15} /> Schedule on board</Button>
  ) : canComplete ? (
    <Button variant="primary" onClick={complete} isDisabled={saving} className="button--success"><CheckCircle2 size={15} /> {saving ? "Saving…" : item.kind === "qc_exception" ? "Ready for re-QC" : "Mark complete"}</Button>
  ) : null;
  return <article className={`operational-register__row px-5 py-4 ${item.isBlocking || item.priority === "blocker" ? "operational-register__row--danger" : item.priority === "high" ? "operational-register__row--attention" : ""}`}><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div className="min-w-0"><p className="text-xs font-medium text-[#617b75]">{item.showTitle} · E{String(item.episodeNumber).padStart(2, "0")} {item.episodeTitle}</p><div className="mt-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[#3c4440]">{item.title}</h3>{item.isBlocking && <span className="inline-flex items-center gap-1 rounded-full bg-[#f8e8df] px-2 py-0.5 text-[10px] font-semibold text-[#a15e42]"><ShieldAlert size={11} /> Blocker</span>}<span className={`work-order-priority work-order-priority--${item.priority}`}>{item.priority}</span>{item.workflowState && <WorkflowStateBadge status={item.workflowState.displayStatus} />}</div><p className="mt-1 text-xs text-[#6e7772]">{item.workflowStageName ?? item.workflowState?.primaryStageName ?? "Episode work"}{item.dueAt ? ` · Due ${formatDate(item.dueAt)}` : " · No due date"}</p>{needsBooking && <p className="mt-2 text-xs font-medium text-[#6a7d73]">Reserve a room before marking this internal work complete.</p>}{item.description && <p className="mt-2 text-xs leading-5 text-[#68716d]">{item.description}</p>}<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{canOpenEpisodes && <Link href={`/episodes/${item.episodeId}`} className="font-medium text-[#54776d] hover:underline">Open episode</Link>}{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#54776d] hover:underline"><ExternalLink size={12} /> External reference</a>}</div></div>{action}</div>{message && <p role="status" className={`mt-3 text-xs ${message.includes("completed") || message.includes("handed") ? "text-[#3f7563]" : "text-[#a35e41]"}`}>{message}</p>}</article>;
}

function formatDate(value: Date | string) { return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(value)); }
