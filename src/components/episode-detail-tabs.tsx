"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const tabs = ["Overview", "Workflow", "Bookings", "Budget", "Activity"] as const;
type TabName = (typeof tabs)[number];
type Row = { id: string; [key: string]: unknown };
type EpisodeData = { id?: string; title: string; showTitle: string; seasonNumber: number; number: number; status: string; qcStatus: string; workflowStageId: string | null; workflowStage: string | null; editorName: string | null; producerName: string | null; lockedCutDate: string | null; deliveryDeadline: Date | string | null };
type WorkflowStage = { id: string; name: string; key: string; position: number; canStartEarly?: boolean };
type WorkflowApprovalRule = { id: string; workflowStageId: string; approverRole: string; label: string; approvalOrder: number; isRequired: boolean };
type WorkflowApproval = { id: string; workflowStageId: string; approvalRuleId: string; approverRole: string; requiredPersonId: string | null; status: string; comment: string | null; submittedAt: Date | string; respondedAt: Date | string | null };
type WorkspaceData = { episode: EpisodeData; schedule: Array<Row & { title: string; startsAt: Date | string; roomName: string | null }>; budget: Array<Row & { category: string; actualAmount: string | number; budgetedAmount: string | number }>; activity: Array<Row & { action: string; createdAt: Date | string }>; workflowStages: readonly WorkflowStage[]; workflowApprovalRules: WorkflowApprovalRule[]; workflowApprovals: WorkflowApproval[] };

export function EpisodeDetailTabs({ data }: { data: WorkspaceData }) {
  const [tab, setTab] = useState<TabName>("Overview");

  return (
    <section className="panel overflow-hidden">
      <div className="flex overflow-x-auto border-b border-[#ebeae6] px-4">
        {tabs.map((item) => (
          <Button key={item} variant="tertiary" onPress={() => setTab(item)} className={`h-auto min-w-max rounded-none border-b-2 px-3 py-3 text-xs font-semibold transition ${tab === item ? "border-[#567b72] text-[#385c54]" : "border-transparent text-[#838986] hover:text-[#515a56]"}`}>
            {item}
          </Button>
        ))}
      </div>
      <div className="p-5"><TabContent tab={tab} data={data} /></div>
    </section>
  );
}

function TabContent({ tab, data }: { tab: TabName; data: WorkspaceData }) {
  if (tab === "Overview") {
    return <div className="grid gap-4 sm:grid-cols-3">{[["Workflow stage", data.episode.workflowStage], ["Editor", data.episode.editorName], ["Producer", data.episode.producerName], ["Lock date", data.episode.lockedCutDate], ["Delivery deadline", formatDate(data.episode.deliveryDeadline)], ["QC status", data.episode.qcStatus.replaceAll("_", " ")]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-[#ecebe7] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#878c89]">{label}</p><p className="mt-1.5 text-sm font-medium capitalize text-[#3e4642]">{value || "—"}</p></div>)}</div>;
  }
  if (tab === "Workflow") return <WorkflowPanel episodeId={data.episode.id} initialStageId={data.episode.workflowStageId} stages={data.workflowStages} rules={data.workflowApprovalRules} approvals={data.workflowApprovals} />;
  if (tab === "Bookings") return <List empty="No scheduled room bookings." items={data.schedule} render={(item) => <><b>{item.title}</b><span>{formatDate(item.startsAt)} · {item.roomName}</span></>} />;
  if (tab === "Budget") return <List empty="No budget lines are linked." items={data.budget} render={(item) => <><b>{item.category}</b><span>${Number(item.actualAmount).toLocaleString()} actual / ${Number(item.budgetedAmount).toLocaleString()} estimate</span></>} />;
  return <List empty="No recent activity." items={data.activity} render={(item) => <><b className="capitalize">{item.action.replaceAll(".", " ").replaceAll("_", " ")}</b><span>{formatDate(item.createdAt)}</span></>} />;
}

function WorkflowPanel({ episodeId, initialStageId, stages, rules, approvals }: { episodeId?: string; initialStageId: string | null; stages: readonly WorkflowStage[]; rules: WorkflowApprovalRule[]; approvals: WorkflowApproval[] }) {
  const router = useRouter();
  const [currentStageId, setCurrentStageId] = useState(initialStageId ?? stages[0]?.id ?? "");
  const [selectedStageId, setSelectedStageId] = useState(initialStageId ?? stages[0]?.id ?? "");
  const [approvalState, setApprovalState] = useState(approvals);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");

  const stageStatus = (stageId: string) => {
    const stageRules = rules.filter((rule) => rule.workflowStageId === stageId);
    const stageApprovals = approvalState.filter((approval) => approval.workflowStageId === stageId);
    const required = stageRules;
    if (required.length && required.every((rule) => stageApprovals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return "approved";
    if (stageApprovals.length) return "awaiting_sign_off";
    return stageId === currentStageId ? "in_progress" : "not_started";
  };

  const currentStatus = stageStatus(currentStageId);
  const currentRules = rules.filter((rule) => rule.workflowStageId === currentStageId);
  const currentStage = stages.find((stage) => stage.id === currentStageId);
  const selectedStage = stages.find((stage) => stage.id === selectedStageId);
  const selectedRules = rules.filter((rule) => rule.workflowStageId === selectedStageId);

  async function save() {
    if (!episodeId || !selectedStageId) return;
    const selected = stages.find((stage) => stage.id === selectedStageId);
    if (selectedStageId !== currentStageId) {
      if (!selected?.canStartEarly) {
        if (currentStage && selected && selected.position !== currentStage.position + 1) {
          setMessage("Workflow stages normally proceed in order. Enable Allow early start in workflow settings to make an exception.");
          return;
        }
        if (currentStatus !== "approved") {
          setMessage("Complete the current sign-off first.");
          return;
        }
      }
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: selectedStageId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Could not update the workflow stage.");
        return;
      }
      setCurrentStageId(selectedStageId);
      setMessage("Workflow stage updated.");
      router.refresh();
    } catch {
      setMessage("Could not update the workflow stage.");
    } finally {
      setSaving(false);
    }
  }

  async function signOff() {
    if (!episodeId || !currentStageId) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: currentStageId, action: "sign_off", comment }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Could not record the sign-off.");
        return;
      }
      const signedRule = currentRules.find((rule) => rule.id === body?.approvalRuleId);
      if (signedRule) setApprovalState((items) => {
        const existing = items.find((approval) => approval.approvalRuleId === signedRule.id);
        return existing ? items.map((approval) => approval.approvalRuleId === signedRule.id ? { ...approval, status: "approved", comment, respondedAt: new Date() } : approval) : [...items, { id: `sign-off-${signedRule.id}`, workflowStageId: currentStageId, approvalRuleId: signedRule.id, approverRole: signedRule.approverRole, requiredPersonId: null, status: "approved", comment, submittedAt: new Date(), respondedAt: new Date() }];
      });
      setComment("");
      setMessage(body?.stageComplete ? "Stage fully signed off." : "Sign-off recorded.");
      if (!body?.debug) router.refresh();
    } catch {
      setMessage("Could not record the sign-off.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-lg border border-[#e4e7e2] bg-[#fafbf9] p-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7c837f]">Current stage</p><p className="mt-1 text-sm font-semibold text-[#3e4642]">{currentStage?.name ?? "Not set"}</p></div>
          <div className="flex gap-2"><select aria-label="Select workflow stage" value={selectedStageId} onChange={(event) => setSelectedStageId(event.target.value)} className="h-9 min-w-0 rounded-md border border-[#dfe1dc] bg-[#fafbf9] px-2 text-xs">{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.position}. {stage.name}</option>)}</select><button type="button" onClick={save} disabled={saving || selectedStageId === currentStageId} className="h-9 shrink-0 rounded-md bg-[#263130] px-3 text-xs font-semibold text-white disabled:opacity-50">Update stage</button></div>
        </div>
        {selectedStageId !== currentStageId && <div className="mt-3 rounded-md border border-[#dce6e1] bg-[#f5f8f6] px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#597169]">Selected-stage sign-off roles · {selectedStage?.name}</p><p className="mt-1 text-xs text-[#58635e]">{selectedRules.map((rule) => rule.label).join(" · ") || "No sign-offs configured"}</p><p className="mt-1 text-[11px] text-[#77817c]">These sign-offs apply after the stage becomes current.</p></div>}
        <div className="mt-4 border-t border-[#e6e8e3] pt-3">
          <p className="text-xs font-semibold text-[#4b5651]">Current-stage sign-off · {currentStage?.name ?? "Not set"}</p>
          <div className="mt-2 space-y-1.5">{currentRules.map((rule) => <p key={rule.id} className="text-xs text-[#5a625e]">{rule.label}</p>)}{!currentRules.length && <p className="text-xs text-[#858a87]">No sign-offs are configured for this stage.</p>}</div>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Optional sign-off note…" className="mt-3 w-full rounded-md border border-[#dfe1dc] p-2 text-xs" />
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={signOff} disabled={saving || currentStatus === "approved" || !currentRules.length} className="rounded-md bg-[#3f7563] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Sign off"}</button></div>
        </div>
      </div>
      <p className="mb-4 rounded-lg bg-[#f4f6f3] px-3 py-2 text-xs leading-5 text-[#66706b]">Stages progress in the order configured by your post house. Stages marked Allow early start may begin out of sequence. Green indicates every configured sign-off is complete.</p>
      <div className="space-y-3">{stages.map((stage) => { const status = stageStatus(stage.id); const stageRules = rules.filter((rule) => rule.workflowStageId === stage.id); return <div key={stage.id} className="flex items-start gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${status === "approved" ? "bg-[#dfeae6] text-[#467367]" : "bg-[#f0efec] text-[#8a8e8c]"}`}>{status === "approved" ? "✓" : stage.position}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`text-sm ${status === "approved" ? "font-medium text-[#3f635a]" : "text-[#4b5350]"}`}>{stage.name}</span><span className="rounded bg-[#edf0ed] px-1.5 py-0.5 text-[10px] font-semibold text-[#65736e]">{status.replaceAll("_", " ")}</span>{stage.id === currentStageId && <span className="text-[10px] font-semibold text-[#536f67]">Current</span>}</div><p className="mt-1 text-xs text-[#858a87]">{stageRules.map((rule) => rule.label).join(" · ") || "No sign-offs configured"}</p></div></div>; })}</div>
      {message && <p role="status" className={`mt-4 text-xs ${message.includes("Could not") || message.includes("Complete") ? "text-[#a35e41]" : "text-[#3f7563]"}`}>{message}</p>}
    </div>
  );
}

function List<T extends Row>({ items, empty, render }: { items: T[]; empty: string; render: (item: T) => React.ReactNode }) {
  return items.length ? <div className="divide-y divide-[#efeeea]">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm text-[#474f4b]"><div className="min-w-0"><div className="truncate">{render(item)}</div></div></div>)}</div> : <p className="py-7 text-center text-sm text-[#858a87]">{empty}</p>;
}

function formatDate(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(value)) : "—";
}
