"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import Link from "next/link";
import { useMemo } from "react";
import type { SelectHTMLAttributes } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import type { DeliveryManifest } from "@/components/delivery-manifest-panel";
import { getDeliveryRegisterState, getNextDeliveryAction } from "@/lib/delivery-register-state";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";
import { EmptyState, OperationalPanel, PanelHeader, StatusChip } from "@/components/operations-ui";

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

const filtersSchema = z.object({ showId: z.string(), state: z.string() });
type Filters = z.infer<typeof filtersSchema>;
const defaults: Filters = { showId: "", state: "" };

export function DeliveryRegister({ entries }: { entries: DeliveryRegisterEntry[] }) {
  const form = useForm<Filters>({ resolver: zodResolver(filtersSchema), defaultValues: defaults });
  const filters = useWatch({ control: form.control }) ?? defaults;
  const shows = useMemo(() => unique(entries.map((entry) => ({ id: entry.showId, label: entry.showTitle }))), [entries]);
  const filtered = entries.filter((entry) => {
    if (filters.showId && entry.showId !== filters.showId) return false;
    if (filters.state && getDeliveryRegisterState(entry) !== filters.state) return false;
    return true;
  });
  return <div className="space-y-5"><OperationalPanel className="flex flex-wrap items-end gap-3 p-4"><FilterSelect label="Show" {...form.register("showId")} options={shows} /><FilterSelect label="Delivery state" {...form.register("state")} options={[{ id: "needs_attention", label: "Needs attention" }, { id: "in_progress", label: "In progress" }, { id: "dispatched", label: "Dispatched" }, { id: "accepted", label: "Receipt confirmed" }, { id: "not_configured", label: "Checklist not set up" }]} /><Button type="button" variant="tertiary" onPress={() => form.reset(defaults)} className="mb-0.5 text-xs text-[#68736d]">Clear filters</Button></OperationalPanel>
    <OperationalPanel className="operational-register overflow-hidden"><PanelHeader className="operational-register__header" title="Episode delivery register" description="A simple view of what needs attention next." action={<StatusChip label={`${filtered.length} episodes`} />} />{filtered.length ? <div className="divide-y divide-[#efefeb]">{filtered.map((entry) => <RegisterRow key={entry.episodeId} entry={entry} />)}</div> : <EmptyState title="No episodes match these filters." description="Clear a filter or apply a delivery profile to an episode." />}</OperationalPanel></div>;
}

function RegisterRow({ entry }: { entry: DeliveryRegisterEntry }) {
  if (!entry.manifest) return <article className="operational-register__row operational-register__row--attention flex flex-wrap items-center justify-between gap-4 px-5 py-4"><EpisodeTitle entry={entry} /><div className="min-w-48"><span className="rounded-full bg-[#f4eee5] px-2.5 py-1 text-[10px] font-semibold text-[#94633d]">Checklist not set up</span><p className="mt-1 text-xs text-[#7c847f]">Apply the right delivery profile from the episode.</p></div><OpenEpisode episodeId={entry.episodeId} /></article>;
  const readiness = entry.manifest.readiness;
  const nextAction = getNextDeliveryAction(entry);
  return <article className={`operational-register__row flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${readiness.deadlineRisk === "overdue" ? "operational-register__row--danger" : readiness.deadlineRisk === "at_risk" ? "operational-register__row--attention" : ""}`}><EpisodeTitle entry={entry} /><div className="min-w-36"><Risk risk={readiness.deadlineRisk} /><p className="mt-1 text-xs text-[#7c847f]">Due {formatDate(entry.deliveryDeadline)}</p></div><div className="min-w-32"><p className="text-xs font-semibold text-[#46524c]">{readiness.completedRequiredItemCount}/{readiness.requiredItemCount} required items</p><div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-[#e6e9e5]"><div className="h-full rounded-full bg-[#5f8578]" style={{ width: `${readiness.progressPercent}%` }} /></div></div><div className="min-w-52"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d8580]">Next action</p><p className="mt-1 text-xs font-medium text-[#59655f]">{nextAction}</p></div><OpenEpisode episodeId={entry.episodeId} /></article>;
}

function EpisodeTitle({ entry }: { entry: DeliveryRegisterEntry }) { return <div className="min-w-52"><p className="font-semibold text-[#3f4944]">{entry.showTitle}</p><p className="mt-1 text-xs text-[#78817c]">S{entry.seasonNumber} · E{String(entry.episodeNumber).padStart(2, "0")} {entry.episodeTitle}</p>{entry.workflowState && <div className="mt-2 flex flex-wrap items-center gap-1.5"><WorkflowStateBadge status={entry.workflowState.displayStatus} /><span className="text-[10px] text-[#7c847f]">{entry.workflowState.primaryStageName ?? "No active stage"}</span></div>}</div>; }
function OpenEpisode({ episodeId }: { episodeId: string }) { return <Link href={`/episodes/${episodeId}`} className="text-xs font-semibold text-[#4d766a] hover:underline">Open checklist →</Link>; }

function FilterSelect({ label, options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: Array<{ id: string; label: string }> }) { return <label className="min-w-0 text-[10px] font-semibold uppercase tracking-[.08em] text-[#78817b]">{label}<select {...props} className="mt-1.5 h-9 w-full truncate rounded-md border border-[#dfe3df] bg-white px-2 text-xs font-normal normal-case tracking-normal text-[#47514c] outline-none focus:border-[#74958a]"><option value="">All</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>; }
function unique(items: Array<{ id: string; label: string }>) { return Array.from(new Map(items.map((item) => [item.id, item])).values()); }
function Risk({ risk }: { risk: string }) { return <StatusChip label={risk.replaceAll("_", " ")} tone={risk === "overdue" ? "danger" : risk === "at_risk" ? "warning" : "success"} />; }
function formatDate(value: Date | string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value)) : "No deadline"; }
