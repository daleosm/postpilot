"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { CheckCircle2, History, LockKeyhole, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { postpilotApiFetch } from "@/lib/postpilot-api-client";

const revisionSchema = z.object({
  name: z.string().trim().min(2, "Name the estimate or revision."),
  reason: z.string().trim().min(4, "Give a short reason for this revision."),
});

type RevisionValues = z.infer<typeof revisionSchema>;
export type EstimateOverview = {
  originalEstimate: number | null;
  currentApprovedEstimate: number | null;
  workingEstimate: number;
  actual: number;
  allocatedActual: number;
  unallocatedOperationalActual: number;
  remainingPlanned: number;
  forecast: number;
  forecastBasis: "open_revision" | "current_approved_estimate" | "working_plan";
  variance: number | null;
  commercialForecast: {
    agreedFlatFeeRevenue: number;
    flatFeeInternalActual: number;
    flatFeeInternalForecast: number;
    flatFeeForecastMargin: number;
    flatFeeMarginAtRisk: boolean;
  };
  isLocked: boolean;
  openRevisionId: string | null;
  currency: string;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    name: string;
    reason: string;
    status: "draft" | "approved" | "superseded";
    approvedAmount: number | null;
    approvedAt: string | null;
    itemCount: number;
  }>;
};

export function EstimateRevisionPanel({ episodeId, estimate }: { episodeId: string; estimate: EstimateOverview }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const form = useForm<RevisionValues>({
    resolver: zodResolver(revisionSchema),
    defaultValues: {
      name: estimate.currentApprovedEstimate === null ? "Original estimate" : `Revision ${estimate.revisions.length + 1}`,
      reason: "",
    },
  });
  const hasApprovedEstimate = estimate.currentApprovedEstimate !== null;
  const openRevision = estimate.revisions.find((revision) => revision.id === estimate.openRevisionId);

  const createRevision = async (values: RevisionValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await postpilotApiFetch(`/budget/episodes/${episodeId}/estimate-revisions`, {
        method: "POST",
        body: { name: values.name, reason: values.reason, approve_immediately: !hasApprovedEstimate },
      });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the estimate revision.");
    } finally {
      setSubmitting(false);
    }
  };
  const approveRevision = async () => {
    if (!estimate.openRevisionId || !window.confirm("Approve this revision and lock its current cost plan?")) return;
    setSubmitting(true);
    setError(null);
    try {
      await postpilotApiFetch(`/budget/episodes/${episodeId}/estimate-revisions/${estimate.openRevisionId}/approve`, { method: "POST" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to approve the estimate revision.");
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="panel overflow-hidden">
    <div className="flex flex-col justify-between gap-4 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-center">
      <div>
        <div className="flex items-center gap-2"><History size={16} className="text-[#58756b]" /><h2 className="text-sm font-semibold text-[#343b38]">Estimate revisions & forecast</h2></div>
        <p className="mt-1 text-xs text-[#7d837f]">Forecast is recorded actuals plus remaining planned work. Approved estimates stay immutable.</p>
      </div>
      {estimate.openRevisionId ? <Button variant="primary" className="bg-[#3e7160] text-white" onPress={approveRevision} isDisabled={submitting}><CheckCircle2 size={15} />{submitting ? "Approving…" : "Approve revision"}</Button> : <Button variant="primary" className="bg-[#263130] text-white" onPress={() => setOpen(true)}><Plus size={15} />{hasApprovedEstimate ? "Create revision" : "Approve estimate"}</Button>}
    </div>
    <div className="grid gap-px bg-[#ebeae6] sm:grid-cols-2 lg:grid-cols-5">
      <Amount label="Original" value={estimate.originalEstimate} currency={estimate.currency} />
      <Amount label="Current approved" value={estimate.currentApprovedEstimate} currency={estimate.currency} />
      <Amount label="Actual" value={estimate.actual} currency={estimate.currency} detail={estimate.unallocatedOperationalActual > 0 ? `${money(estimate.unallocatedOperationalActual, estimate.currency)} unallocated operational cost` : undefined} />
      <Amount label="Remaining plan" value={estimate.remainingPlanned} currency={estimate.currency} />
      <Amount label="Forecast" value={estimate.forecast} currency={estimate.currency} emphasis />
    </div>
    <div className="px-5 py-3">
      {estimate.openRevisionId ? <p className="flex items-center gap-2 text-xs text-[#856540]"><LockKeyhole size={14} /> <span><strong>{openRevision?.name ?? "Revision"}</strong> is open. Forecast reflects this working plan; approve it to lock the revision.</span></p> : estimate.isLocked ? <p className="flex items-center gap-2 text-xs text-[#66716c]"><LockKeyhole size={14} /> The approved plan is locked. Create a named revision with a reason before changing planned costs.</p> : <p className="text-xs text-[#66716c]">Build the working plan, then approve it to create the first immutable estimate snapshot.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-[#a35e41]">{error}</p>}
      {estimate.revisions.length > 0 && <div className="mt-3 divide-y divide-[#efeeea] border-t border-[#efeeea]">{estimate.revisions.map((revision) => <div key={revision.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"><span className={`w-fit rounded-full px-2 py-0.5 font-semibold capitalize ${revision.status === "approved" ? "bg-[#e6f0eb] text-[#3e7160]" : revision.status === "draft" ? "bg-[#f9f0dc] text-[#906f3d]" : "bg-[#f0f0ed] text-[#767c78]"}`}>{revision.status}</span><span className="min-w-0"><strong className="text-[#454e49]">{revision.name}</strong><span className="ml-2 text-[#858a87]">{revision.reason}</span></span><span className="text-[#68716d]">{revision.approvedAmount === null ? "Working" : money(revision.approvedAmount, estimate.currency)}</span></div>)}</div>}
    </div>
    {open && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form onSubmit={form.handleSubmit(createRevision)} className="w-full max-w-lg rounded-t-2xl bg-[#fefefa] p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.1em] text-[#708078]">Commercial control</p><h3 className="mt-1 text-lg font-semibold text-[#28312e]">{hasApprovedEstimate ? "Create estimate revision" : "Approve working estimate"}</h3><p className="mt-1 text-sm text-[#737a76]">{hasApprovedEstimate ? "This opens an editable revision and records why the plan changed." : "This freezes the current working cost plan as the original estimate."}</p></div><Button isIconOnly variant="tertiary" aria-label="Close" onPress={() => setOpen(false)}><X size={18} /></Button></div>
        <div className="mt-5 space-y-4"><Field label="Revision name" error={form.formState.errors.name?.message}><input className="control" {...form.register("name")} /></Field><Field label="Reason" error={form.formState.errors.reason?.message}><textarea className="control min-h-24" {...form.register("reason")} placeholder="For example: additional mix day approved after client changes." /></Field></div>
        {error && <p role="alert" className="mt-3 text-sm text-[#a35e41]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" className="bg-[#263130] text-white" isDisabled={submitting}>{submitting ? "Saving…" : hasApprovedEstimate ? "Open revision" : "Approve estimate"}</Button></div>
      </form>
    </div>}
  </section>;
}

function Amount({ label, value, currency, emphasis = false, detail }: { label: string; value: number | null; currency: string; emphasis?: boolean; detail?: string }) {
  return <div className="bg-white px-5 py-3"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#858a87]">{label}</p><p className={`mt-1 text-base font-semibold ${emphasis ? "text-[#3e7160]" : "text-[#343d39]"}`}>{value === null ? "—" : money(value, currency)}</p>{detail && <p className="mt-1 text-[10px] leading-4 text-[#956a58]">{detail}</p>}</div>;
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-[#48514d]"><span>{label}</span><div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#a65f42]">{error}</span>}</label>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
