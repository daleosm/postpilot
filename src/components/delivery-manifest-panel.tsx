"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { ExternalLink, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

type DeliveryItem = {
  id: string;
  componentType: string;
  label: string;
  required: boolean;
  formatSpecification: string | null;
  version: string | null;
  territory: string | null;
  language: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  requiresExternalRecipient: boolean;
  recipientSnapshotAt: Date | string | null;
  qcRequired: boolean;
  status: string;
  dueDate: Date | string | null;
  externalUrl: string | null;
  externalReference: string | null;
  submissionMethod: string | null;
  qcResult: string;
  receiptConfirmedAt: Date | string | null;
  receiptConfirmedBy: string | null;
  rejectionReason: string | null;
  waiverReason: string | null;
};

export type DeliveryManifest = {
  profileName: string;
  specificationUrl: string | null;
  items: DeliveryItem[];
  readiness: {
    requiredItemCount: number;
    completedRequiredItemCount: number;
    outstandingRequiredItemCount: number;
    progressPercent: number;
    facilityDispatched: boolean;
    clientNetworkAccepted: boolean;
    deadlineRisk: "on_track" | "at_risk" | "overdue";
    overdueRequiredItemCount: number;
    atRiskRequiredItemCount: number;
    requiredItemsWithoutDueDate: number;
    missingRequiredRecipientCount: number;
    hasDeliveryContactGaps: boolean;
  };
  history: Array<{ id: string; action: string; metadata: unknown; createdAt: Date | string; actorName: string | null }>;
};

const transitionSchema = z.object({
  reason: z.string().trim().min(3, "Add a brief operational note.").max(4000),
  externalReference: z.string().trim().max(500).optional(),
  externalUrl: z.union([z.string().url("Enter a valid external link."), z.literal("")]).optional(),
  submissionMethod: z.string().trim().max(120).optional(),
  receiptConfirmedBy: z.string().trim().max(240).optional(),
});
type TransitionValues = z.infer<typeof transitionSchema>;

export function DeliveryManifestPanel({ episodeId, manifest, profiles, canManageManifest, canUpdate, canConfirmReceipt }: { episodeId: string; manifest: DeliveryManifest | null; profiles: Array<{ id: string; name: string }>; canManageManifest: boolean; canUpdate: boolean; canConfirmReceipt: boolean }) {
  if (!manifest) return <div className="rounded-xl border border-dashed border-[#dfe3de] bg-[#fafbf9] px-5 py-12 text-center"><p className="text-sm font-semibold text-[#4e5853]">Set up the delivery checklist</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[#7b837e]">Choose the network or client delivery profile for this episode. It creates a fixed checklist; later profile edits will not change it.</p>{canManageManifest ? <ApplyProfileForm episodeId={episodeId} profiles={profiles} /> : <p className="mt-4 text-xs text-[#838b86]">An authorised user can apply the appropriate delivery profile.</p>}</div>;
  const { readiness } = manifest;
  const blockers = manifest.items.filter((item) => item.required && ["qc_failed", "rejected"].includes(item.status));
  const optionalCount = manifest.items.length - readiness.requiredItemCount;
  return <div className="space-y-5">
    <section className="rounded-xl border border-[#e4e7e3] bg-[#fafbf9] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#77817d]">Delivery checklist</p><h2 className="mt-1 text-lg font-semibold text-[#303936]">{manifest.profileName}</h2><p className="mt-1 text-xs text-[#727b76]">{readiness.completedRequiredItemCount} of {readiness.requiredItemCount} required items complete{optionalCount ? ` · ${optionalCount} optional` : ""}</p></div><RiskBadge risk={readiness.deadlineRisk} /></div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e6e9e5]"><div className="h-full rounded-full bg-[#5f8578]" style={{ width: `${readiness.progressPercent}%` }} /></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><Metric label="Checklist" value={`${readiness.progressPercent}% ready`} /><Metric label="Facility dispatch" value={readiness.facilityDispatched ? "Complete" : `${readiness.outstandingRequiredItemCount} to send`} tone={readiness.facilityDispatched ? "good" : undefined} /><Metric label="Client receipt" value={readiness.clientNetworkAccepted ? "Confirmed" : "Awaiting"} tone={readiness.clientNetworkAccepted ? "good" : undefined} /></div>
      {manifest.specificationUrl && <a href={manifest.specificationUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#47756a] hover:underline">Delivery specification <ExternalLink size={12} /></a>}
    </section>
    {(blockers.length > 0 || readiness.hasDeliveryContactGaps || readiness.overdueRequiredItemCount > 0) && <section className="rounded-xl border border-[#efd9cf] bg-[#fffaf7] p-4"><p className="text-xs font-semibold text-[#94573d]">Delivery blockers</p><div className="mt-2 space-y-1 text-sm leading-6 text-[#795b4e]">{blockers.map((item) => <p key={item.id}><b>{item.label}</b> is {item.status.replaceAll("_", " ")}.</p>)}{readiness.hasDeliveryContactGaps && <p>{readiness.missingRequiredRecipientCount} required item{readiness.missingRequiredRecipientCount === 1 ? " needs" : "s need"} an external recipient before dispatch.</p>}{readiness.overdueRequiredItemCount > 0 && <p>{readiness.overdueRequiredItemCount} required item{readiness.overdueRequiredItemCount === 1 ? " is" : "s are"} overdue.</p>}</div></section>}
    <section className="overflow-hidden rounded-xl border border-[#e5e7e3]"><div className="flex items-center justify-between gap-3 border-b border-[#ebece8] px-4 py-3"><div><p className="text-sm font-semibold text-[#39423e]">Required delivery items</p><p className="mt-0.5 text-xs text-[#7b837e]">Complete each item, then dispatch and confirm receipt.</p></div><span className="rounded-full bg-[#edf1ed] px-2.5 py-1 text-[11px] font-semibold text-[#617069]">{manifest.items.length} items</span></div><div className="divide-y divide-[#eceeea]">{manifest.items.map((item) => <DeliveryItemRow key={item.id} episodeId={episodeId} item={item} canUpdate={canUpdate} canConfirmReceipt={canConfirmReceipt} />)}</div></section>
    <details className="overflow-hidden rounded-xl border border-[#e5e7e3]"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#39423e]">Activity history <span className="ml-1 text-xs font-normal text-[#7b837e]">({manifest.history.length})</span></summary>{manifest.history.length ? <div className="divide-y divide-[#eceeea] border-t border-[#ebece8]">{manifest.history.map((event) => <div key={event.id} className="flex items-start justify-between gap-4 px-4 py-3"><div className="min-w-0"><p className="text-xs font-semibold text-[#4a554f]">{historyLabel(event.action)}</p><p className="mt-1 text-xs leading-5 text-[#78817c]">{historyDetail(event.metadata)}{event.actorName ? ` · ${event.actorName}` : ""}</p></div><time className="shrink-0 text-[11px] text-[#8a918d]">{formatDateTime(event.createdAt)}</time></div>)}</div> : <p className="border-t border-[#ebece8] px-4 py-8 text-center text-sm text-[#858b87]">No delivery activity has been recorded yet.</p>}</details>
  </div>;
}

const applyProfileSchema = z.object({ deliveryProfileId: z.string().uuid("Choose a delivery profile."), reason: z.string().trim().min(3, "Explain why this profile is being applied.").max(2000) });
type ApplyProfileValues = z.infer<typeof applyProfileSchema>;

function ApplyProfileForm({ episodeId, profiles }: { episodeId: string; profiles: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const form = useForm<ApplyProfileValues>({ resolver: zodResolver(applyProfileSchema), defaultValues: { deliveryProfileId: profiles[0]?.id ?? "", reason: "" } });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    const response = await fetch(`/api/episodes/${episodeId}/delivery-manifest/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return setMessage(body?.error ?? "Could not apply the delivery profile.");
    router.refresh();
  });
  if (!profiles.length) return <p className="mt-4 text-xs text-[#a16545]">No active delivery profiles are available for this post house.</p>;
  return <form onSubmit={submit} className="mx-auto mt-5 grid max-w-xl gap-2 text-left sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"><select aria-label="Delivery profile" {...form.register("deliveryProfileId")} className="h-9 rounded-md border border-[#dfe4df] bg-white px-2 text-xs text-[#424c47] outline-none focus:border-[#74958a]">{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><input aria-label="Profile application reason" {...form.register("reason")} placeholder="Reason for applying this profile" className="h-9 rounded-md border border-[#dfe4df] bg-white px-3 text-xs text-[#424c47] outline-none focus:border-[#74958a]" /><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#3f7563] text-white">{form.formState.isSubmitting ? "Applying…" : "Apply profile"}</Button>{(form.formState.errors.reason?.message || message) && <p role="status" className="sm:col-span-3 text-xs text-[#a35e41]">{form.formState.errors.reason?.message || message}</p>}</form>;
}

function DeliveryItemRow({ episodeId, item, canUpdate, canConfirmReceipt }: { episodeId: string; item: DeliveryItem; canUpdate: boolean; canConfirmReceipt: boolean }) {
  const details = [item.version, item.territory, item.language, item.formatSpecification].filter(Boolean).join(" · ");
  const canDispatch = canUpdate && (item.status === "qc_passed" || (item.status === "ready_for_qc" && !item.qcRequired));
  const canReceipt = canConfirmReceipt && item.status === "dispatched";
  return <div className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[#404a45]">{item.label}</p>{item.required ? <span className="rounded-full bg-[#e7eee8] px-2 py-0.5 text-[10px] font-semibold text-[#4d7063]">Required</span> : <span className="rounded-full bg-[#eff1ef] px-2 py-0.5 text-[10px] font-semibold text-[#6f7873]">Optional</span>}<span className="text-xs text-[#77817c]">Due {formatDate(item.dueDate)}</span></div><p className="mt-1 text-xs text-[#77817c]">{details || item.componentType}</p></div><StatusBadge status={item.status} /></div>
    <details className="mt-3 text-xs text-[#69746f]"><summary className="cursor-pointer font-medium text-[#547168]">Delivery details</summary><div className="mt-2 grid gap-2 rounded-lg bg-[#f7f9f7] p-3 sm:grid-cols-2"><Detail label="Recipient" value={item.recipientName ?? (item.requiresExternalRecipient ? "Required before dispatch" : "Not specified")} /><Detail label="QC" value={item.qcRequired ? item.qcResult.replaceAll("_", " ") : "Not required"} /><Detail label="Receipt" value={item.receiptConfirmedAt ? `Confirmed ${formatDate(item.receiptConfirmedAt)}` : "Awaiting"} />{(item.externalReference || item.externalUrl) && <p>{item.externalUrl ? <a className="inline-flex items-center gap-1 font-semibold text-[#47756a] hover:underline" href={item.externalUrl} target="_blank" rel="noreferrer">{item.externalReference || "Open external reference"} <ExternalLink size={12} /></a> : <span className="font-medium text-[#60706a]">Reference: {item.externalReference}</span>}</p>}</div></details>
    {(canDispatch || canReceipt) && <div className="mt-4 border-t border-[#edf0ec] pt-3"><DeliveryTransitionForm episodeId={episodeId} item={item} target={canDispatch ? "dispatched" : "receipt_confirmed"} /></div>}
  </div>;
}

function DeliveryTransitionForm({ episodeId, item, target }: { episodeId: string; item: DeliveryItem; target: "dispatched" | "receipt_confirmed" }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const form = useForm<TransitionValues>({ resolver: zodResolver(transitionSchema), defaultValues: { reason: "", externalReference: item.externalReference ?? "", externalUrl: item.externalUrl ?? "", submissionMethod: item.submissionMethod ?? "", receiptConfirmedBy: "" } });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    const response = await fetch(`/api/episodes/${episodeId}/delivery-items/${item.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: target, reason: values.reason, externalReference: values.externalReference || null, externalUrl: values.externalUrl || null, submissionMethod: values.submissionMethod || null, receiptConfirmedBy: values.receiptConfirmedBy || null }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return setMessage(body?.error ?? "Could not update this delivery item.");
    setMessage(target === "dispatched" ? "Item dispatched." : "Recipient receipt confirmed.");
    form.reset();
    router.refresh();
  });
  const dispatch = target === "dispatched";
  return <form onSubmit={submit} className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label className="sr-only" htmlFor={`${item.id}-reason`}>Operational note</label><input id={`${item.id}-reason`} {...form.register("reason")} placeholder={dispatch ? "Dispatch note" : "Receipt note"} className="h-9 rounded-md border border-[#dfe4df] bg-white px-3 text-xs text-[#424c47] outline-none focus:border-[#74958a]" /><label className="sr-only" htmlFor={`${item.id}-reference`}>External reference</label>{dispatch ? <input id={`${item.id}-reference`} {...form.register("externalReference")} placeholder="External reference or link" className="h-9 rounded-md border border-[#dfe4df] bg-white px-3 text-xs text-[#424c47] outline-none focus:border-[#74958a]" /> : <input id={`${item.id}-receipt`} {...form.register("receiptConfirmedBy")} placeholder="Confirmed by (optional)" className="h-9 rounded-md border border-[#dfe4df] bg-white px-3 text-xs text-[#424c47] outline-none focus:border-[#74958a]" />}<Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className={dispatch ? "bg-[#3f7563] text-white" : "bg-[#355b6d] text-white"}>{dispatch ? <><Send size={14} /> {form.formState.isSubmitting ? "Dispatching…" : "Dispatch"}</> : <><ShieldCheck size={14} /> {form.formState.isSubmitting ? "Confirming…" : "Confirm receipt"}</>}</Button>{(form.formState.errors.reason?.message || form.formState.errors.externalUrl?.message || message) && <p role="status" className={`lg:col-span-3 text-xs ${message && !message.includes("Could not") ? "text-[#3f7563]" : "text-[#a35e41]"}`}>{form.formState.errors.reason?.message || form.formState.errors.externalUrl?.message || message}</p>}</form>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" }) { return <div className="rounded-lg border border-[#e4e8e4] bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7b847f]">{label}</p><p className={`mt-1 text-xs font-semibold ${tone ? "text-[#3e7561]" : "text-[#4f5954]"}`}>{value}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <p><span className="font-medium text-[#7a837e]">{label}: </span><span className="capitalize">{value}</span></p>; }
function RiskBadge({ risk }: { risk: "on_track" | "at_risk" | "overdue" }) { const styles = risk === "overdue" ? "bg-[#f8e7df] text-[#a45f43]" : risk === "at_risk" ? "bg-[#f6eddc] text-[#986638]" : "bg-[#e2eee6] text-[#3d7160]"; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles}`}>{risk.replaceAll("_", " ")}</span>; }
function StatusBadge({ status }: { status: string }) { const tone = status === "receipt_confirmed" || status === "waived" ? "bg-[#e2eee6] text-[#3d7160]" : ["qc_failed", "rejected"].includes(status) ? "bg-[#f8e7df] text-[#a45f43]" : status === "dispatched" ? "bg-[#e3edf0] text-[#3d6574]" : "bg-[#eff1ef] text-[#68736d]"; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${tone}`}>{status.replaceAll("_", " ")}</span>; }
function formatDate(value: Date | string | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "Not set"; }
function formatDateTime(value: Date | string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)); }
function historyLabel(action: string) { return action.replace(/^episode_delivery_item\./, "").replace(/^episode_delivery_manifest\./, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function historyDetail(metadata: unknown) { if (!metadata || typeof metadata !== "object") return "Delivery activity recorded"; const values = metadata as Record<string, unknown>; if (typeof values.reason === "string" && values.reason) return values.reason; if (typeof values.toDueDate === "string") return `Due date set to ${values.toDueDate}`; if (typeof values.toStatus === "string") return `Status: ${values.toStatus.replaceAll("_", " ")}`; return "Delivery activity recorded"; }
