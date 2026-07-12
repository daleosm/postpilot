"use client";

import { Button } from "@heroui/react";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Stage = { id: string; name: string; key: string; position: number; color: string; isTerminal: boolean; canStartEarly: boolean };
type Rule = { id: string; workflowStageId: string; approverRole: string; label: string; approvalOrder: number; isRequired: boolean };
type Workflow = { id: string; name: string; description: string | null; stages: Stage[]; rules: Rule[] };

export function WorkflowTemplateEditor({ workflow, roles }: { workflow: Workflow; roles: Array<{ role: string; label: string }> }) {
  const router = useRouter();
  const [stages, setStages] = useState(workflow.stages);
  const [rules, setRules] = useState(workflow.rules);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggedStageId, setDraggedStageId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function updateStage(id: string, patch: Partial<Stage>) {
    setStages((items) => items.map((stage) => stage.id === id ? { ...stage, ...patch } : stage));
  }

  function updateRule(id: string, patch: Partial<Rule>) {
    setRules((items) => items.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  }

  function addApprovalRule(workflowStageId: string) {
    const stageRules = rules.filter((rule) => rule.workflowStageId === workflowStageId);
    const approvalOrder = Math.max(0, ...stageRules.map((rule) => rule.approvalOrder)) + 1;
    const defaultRole = roles[0] ?? { role: "post_supervisor", label: "Post supervisor" };
    setRules((items) => [...items, { id: crypto.randomUUID(), workflowStageId, approverRole: defaultRole.role, label: `${defaultRole.label} sign-off`, approvalOrder, isRequired: true }]);
  }

  function removeApprovalRule(id: string, workflowStageId: string) {
    setRules((items) => {
      const remaining = items.filter((rule) => rule.id !== id);
      const stageIds = remaining.filter((rule) => rule.workflowStageId === workflowStageId).sort((a, b) => a.approvalOrder - b.approvalOrder).map((rule) => rule.id);
      return remaining.map((rule) => rule.workflowStageId === workflowStageId ? { ...rule, approvalOrder: stageIds.indexOf(rule.id) + 1 } : rule);
    });
  }

  function reorderStages(targetId: string) {
    if (!draggedStageId || draggedStageId === targetId) return;
    setStages((items) => {
      const ordered = [...items].sort((a, b) => a.position - b.position);
      const sourceIndex = ordered.findIndex((stage) => stage.id === draggedStageId);
      const targetIndex = ordered.findIndex((stage) => stage.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return items;
      const [moved] = ordered.splice(sourceIndex, 1);
      ordered.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, moved);
      return ordered.map((stage, index) => ({ ...stage, position: index + 1 }));
    });
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workflow.name, description: workflow.description, stages, rules }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not save the workflow.");
      setMessage("Workflow saved. New approval submissions use these rules.");
      router.refresh();
    } catch {
      setMessage("Could not save the workflow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-[#e5e6e1] bg-[#fafaf8] px-4 py-3 text-xs leading-5 text-[#7d837f]">This is your organization’s single workflow. Stages are sequential by default; allow an early start only where your facility has agreed that work can begin before its normal turn. Existing submitted approvals remain as recorded.</p>

      <section className="panel overflow-hidden">
        <div className="border-b border-[#ebeae6] px-5 py-4">
          <h2 className="text-sm font-semibold text-[#353b39]">Workflow stages and approval gates</h2>
          <p className="mt-1 text-xs text-[#858a87]">Drag stages to set the order. Add as many sign-off rows as this post house needs for each stage.</p>
        </div>
        <div className="divide-y divide-[#efeeea]">
          {[...stages].sort((a, b) => a.position - b.position).map((stage) => {
            const stageRules = rules.filter((rule) => rule.workflowStageId === stage.id).sort((a, b) => a.approvalOrder - b.approvalOrder);
            return (
              <div key={stage.id} onDragOver={(event) => { event.preventDefault(); if (draggedStageId !== stage.id) setDropTargetId(stage.id); }} onDrop={() => { reorderStages(stage.id); setDraggedStageId(null); setDropTargetId(null); }} className={`p-5 transition-colors ${dropTargetId === stage.id ? "bg-[#edf3ef]" : ""}`}>
                <div className="grid gap-3 md:grid-cols-[32px_minmax(220px,1fr)_auto]">
                  <button type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedStageId(stage.id); }} onDragEnd={() => { setDraggedStageId(null); setDropTargetId(null); }} className="mt-5 cursor-grab touch-none self-start rounded p-1 text-[#7d837f] hover:bg-[#efeeea] hover:text-[#353b39] active:cursor-grabbing" aria-label={`Drag to reorder ${stage.name}`} title="Drag to reorder"><GripVertical size={17} /></button>
                  <label className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d837f]">Stage name<input value={stage.name} onChange={(event) => updateStage(stage.id, { name: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#dedfda] px-2 text-sm normal-case tracking-normal" /></label>
                  <label className="flex items-end gap-2 pb-2 text-xs font-medium text-[#59615e]"><input type="checkbox" role="switch" aria-label={`Allow ${stage.name} to start early`} aria-checked={stage.canStartEarly} checked={stage.canStartEarly} onChange={(event) => updateStage(stage.id, { canStartEarly: event.target.checked })} /> Allow early start</label>
                </div>
                {stage.canStartEarly && <p className="mt-2 text-xs leading-5 text-[#68716d]">This stage may start out of sequence.</p>}
                <div className="mt-4 rounded-lg bg-[#fafaf8] p-3">
                  <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d837f]">Approval policy</p><Button size="sm" variant="tertiary" onClick={() => addApprovalRule(stage.id)} className="h-7 border border-[#dfe5e1] bg-white px-2 text-xs text-[#45685e]"><Plus size={13} /> Add sign-off</Button></div>
                  <p className="mt-1 text-xs text-[#858a87]">Each row can be assigned to a different person when the stage is submitted.</p>
                  {stageRules.map((rule, index) => (
                    <div key={rule.id} className="mt-2 grid gap-2 sm:grid-cols-[28px_minmax(170px,1fr)_28px] sm:items-center">
                      <span className="text-center text-xs font-semibold text-[#7c837f]">{index + 1}</span>
                      <select aria-label={`Sign-off role ${index + 1}`} value={rule.approverRole} onChange={(event) => { const role = roles.find((item) => item.role === event.target.value); updateRule(rule.id, { approverRole: event.target.value, label: `${role?.label ?? event.target.value.replaceAll("_", " ")} sign-off` }); }} className="h-8 rounded-md border border-[#dedfda] bg-white px-2 text-xs">{roles.map((role) => <option key={role.role} value={role.role}>{role.label}</option>)}</select>
                      <button type="button" onClick={() => removeApprovalRule(rule.id, stage.id)} className="rounded p-1 text-[#8b918e] hover:bg-[#f3e9e4] hover:text-[#a35e41]" aria-label={`Remove sign-off ${index + 1}`}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  {!stageRules.length && <p className="mt-2 text-xs text-[#858a87]">No approval roles configured for this stage.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className={`text-xs ${message.includes("saved") ? "text-[#4d8068]" : "text-[#a35e41]"}`}>{message}</p>
        <Button variant="primary" onPress={save} isDisabled={saving} className="bg-[#263130] text-white"><Save size={15} /> {saving ? "Saving…" : "Save workflow"}</Button>
      </div>
    </div>
  );
}
