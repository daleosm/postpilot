"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import Link from "next/link";
import { useMemo } from "react";
import type { SelectHTMLAttributes } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import type { DeliveryManifest } from "@/components/delivery-manifest-panel";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";

export type DeliveryRegisterEntry = {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  productionCode: string | null;
  showId: string;
  showTitle: string;
  seasonNumber: number;
  deliveryDeadline: Date | string | null;
  workflowState: { displayStatus: string; primaryStageName: string | null } | null;
  manifest: DeliveryManifest | null;
  manifestState: "applied" | "profile_not_applied";
};

const filtersSchema = z.object({ showId: z.string(), episodeId: z.string(), recipient: z.string(), status: z.string(), risk: z.string(), receipt: z.string() });
type Filters = z.infer<typeof filtersSchema>;
const defaults: Filters = { showId: "", episodeId: "", recipient: "", status: "", risk: "", receipt: "" };

export function DeliveryRegister({ entries }: { entries: DeliveryRegisterEntry[] }) {
  const form = useForm<Filters>({ resolver: zodResolver(filtersSchema), defaultValues: defaults });
  const filters = useWatch({ control: form.control }) ?? defaults;
  const shows = useMemo(() => unique(entries.map((entry) => ({ id: entry.showId, label: entry.showTitle }))), [entries]);
  const episodes = useMemo(() => entries.map((entry) => ({ id: entry.episodeId, label: `${entry.showTitle} · S${entry.seasonNumber} E${String(entry.episodeNumber).padStart(2, "0")} ${entry.episodeTitle}` })), [entries]);
  const recipients = useMemo(() => unique(entries.flatMap((entry) => entry.manifest?.items.map((item) => item.recipientName).filter((value): value is string => Boolean(value)).map((name) => ({ id: name, label: name })) ?? [])), [entries]);
  const filtered = entries.filter((entry) => {
    const items = entry.manifest?.items ?? [];
    if (filters.showId && entry.showId !== filters.showId) return false;
    if (filters.episodeId && entry.episodeId !== filters.episodeId) return false;
    if (filters.recipient && !items.some((item) => item.recipientName === filters.recipient)) return false;
    if (filters.status && !items.some((item) => item.status === filters.status)) return false;
    if (filters.risk && entry.manifest?.readiness.deadlineRisk !== filters.risk) return false;
    if (filters.receipt === "confirmed" && !entry.manifest?.readiness.clientNetworkAccepted) return false;
    if (filters.receipt === "awaiting" && (!entry.manifest || entry.manifest.readiness.clientNetworkAccepted)) return false;
    return true;
  });
  return <div className="space-y-5"><section className="panel p-4"><form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><FilterSelect label="Show" {...form.register("showId")} options={shows} /><FilterSelect label="Episode" {...form.register("episodeId")} options={episodes} /><FilterSelect label="Recipient" {...form.register("recipient")} options={recipients} /><FilterSelect label="Item status" {...form.register("status")} options={["not_started", "preparing", "ready_for_qc", "qc_failed", "qc_passed", "dispatched", "receipt_confirmed", "rejected", "waived"].map((id) => ({ id, label: id.replaceAll("_", " ") }))} /><FilterSelect label="Deadline risk" {...form.register("risk")} options={[{ id: "on_track", label: "On track" }, { id: "at_risk", label: "At risk" }, { id: "overdue", label: "Overdue" }]} /><FilterSelect label="Receipt" {...form.register("receipt")} options={[{ id: "awaiting", label: "Awaiting receipt" }, { id: "confirmed", label: "Receipt confirmed" }]} /><div className="sm:col-span-2 xl:col-span-6 flex justify-end"><Button type="button" variant="tertiary" onPress={() => form.reset(defaults)} className="text-xs text-[#68736d]">Clear filters</Button></div></form></section>
    <section className="panel overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-[#ebeae6] px-5 py-3.5"><div><h2 className="text-sm font-semibold text-[#333a37]">Episode delivery register</h2><p className="mt-0.5 text-xs text-[#7d8580]">{filtered.length} of {entries.length} episode manifests</p></div></div>{filtered.length ? <div className="overflow-x-auto"><table className="min-w-[920px] w-full text-left text-sm"><thead className="border-b border-[#e9ebe7] bg-[#fafbf9] text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d8580]"><tr><th className="px-5 py-3">Episode</th><th className="px-4 py-3">Progress</th><th className="px-4 py-3">Deadline</th><th className="px-4 py-3">Required items</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Receipt</th><th className="px-5 py-3 text-right">Open</th></tr></thead><tbody className="divide-y divide-[#efefeb]">{filtered.map((entry) => <RegisterRow key={entry.episodeId} entry={entry} />)}</tbody></table></div> : <div className="px-5 py-14 text-center"><p className="text-sm font-semibold text-[#515b56]">No delivery manifests match these filters.</p><p className="mt-1 text-sm text-[#858c87]">Clear a filter or apply a delivery profile to an episode.</p></div>}</section></div>;
}

function RegisterRow({ entry }: { entry: DeliveryRegisterEntry }) {
  if (!entry.manifest) return <tr className="transition hover:bg-[#fbfcfa]"><td className="px-5 py-4"><p className="font-semibold text-[#3f4944]">{entry.showTitle}</p><p className="mt-1 text-xs text-[#78817c]">S{entry.seasonNumber} · E{String(entry.episodeNumber).padStart(2, "0")} {entry.episodeTitle}</p>{entry.workflowState && <div className="mt-2 flex flex-wrap items-center gap-1.5"><WorkflowStateBadge status={entry.workflowState.displayStatus} /><span className="text-[10px] text-[#7c847f]">{entry.workflowState.primaryStageName ?? "No active stage"}</span></div>}</td><td className="px-4 py-4" colSpan={4}><span className="rounded-full bg-[#f4eee5] px-2.5 py-1 text-[10px] font-semibold text-[#94633d]">Profile not applied</span><p className="mt-1 text-xs text-[#7c847f]">No delivery checklist has been generated for this episode.</p></td><td className="px-5 py-4 text-right"><Link href={`/episodes/${entry.episodeId}`} className="text-xs font-semibold text-[#4d766a] hover:underline">Open episode →</Link></td></tr>;
  const readiness = entry.manifest.readiness;
  const nextRecipient = entry.manifest.items.find((item) => item.required && !["receipt_confirmed", "waived"].includes(item.status))?.recipientName ?? "—";
  return <tr className="transition hover:bg-[#fbfcfa]"><td className="px-5 py-4"><p className="font-semibold text-[#3f4944]">{entry.showTitle}</p><p className="mt-1 text-xs text-[#78817c]">S{entry.seasonNumber} · E{String(entry.episodeNumber).padStart(2, "0")} {entry.episodeTitle}</p>{entry.workflowState && <div className="mt-2 flex flex-wrap items-center gap-1.5"><WorkflowStateBadge status={entry.workflowState.displayStatus} /><span className="text-[10px] text-[#7c847f]">{entry.workflowState.primaryStageName ?? "No active stage"}</span></div>}</td><td className="px-4 py-4"><div className="flex min-w-28 items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e6e9e5]"><div className="h-full rounded-full bg-[#5f8578]" style={{ width: `${readiness.progressPercent}%` }} /></div><span className="text-xs font-semibold text-[#55625c]">{readiness.progressPercent}%</span></div></td><td className="px-4 py-4"><Risk risk={readiness.deadlineRisk} /><p className="mt-1 text-xs text-[#7c847f]">{formatDate(entry.deliveryDeadline)}</p></td><td className="px-4 py-4 text-xs text-[#64716b]"><b className="font-semibold text-[#46524c]">{readiness.completedRequiredItemCount}/{readiness.requiredItemCount}</b> confirmed{readiness.hasDeliveryContactGaps && <p className="mt-1 text-[#a16545]">Recipient missing</p>}</td><td className="px-4 py-4 text-xs text-[#63706a]">{nextRecipient}</td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${readiness.clientNetworkAccepted ? "bg-[#e2eee6] text-[#3d7160]" : "bg-[#f1f2ef] text-[#67736d]"}`}>{readiness.clientNetworkAccepted ? "Confirmed" : "Awaiting"}</span></td><td className="px-5 py-4 text-right"><Link href={`/episodes/${entry.episodeId}`} className="text-xs font-semibold text-[#4d766a] hover:underline">Open manifest →</Link></td></tr>;
}

function FilterSelect({ label, options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: Array<{ id: string; label: string }> }) { return <label className="min-w-0 text-[10px] font-semibold uppercase tracking-[.08em] text-[#78817b]">{label}<select {...props} className="mt-1.5 h-9 w-full truncate rounded-md border border-[#dfe3df] bg-white px-2 text-xs font-normal normal-case tracking-normal text-[#47514c] outline-none focus:border-[#74958a]"><option value="">All</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>; }
function unique(items: Array<{ id: string; label: string }>) { return Array.from(new Map(items.map((item) => [item.id, item])).values()); }
function Risk({ risk }: { risk: string }) { const tone = risk === "overdue" ? "bg-[#f8e7df] text-[#a45f43]" : risk === "at_risk" ? "bg-[#f6eddc] text-[#986638]" : "bg-[#e2eee6] text-[#3d7160]"; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tone}`}>{risk.replaceAll("_", " ")}</span>; }
function formatDate(value: Date | string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value)) : "No deadline"; }
