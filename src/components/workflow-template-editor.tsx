"use client";

import { Button } from "@heroui/react";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Stage = { id: string; name: string; key: string; position: number; color: string; isTerminal: boolean; canStartEarly: boolean; requiresQcPass: boolean; deliveryGate: "none" | "facility_dispatch" | "client_acceptance" };
type Rule = { id: string; workflowStageId: string; approverRole: string | null; label: string; approvalOrder: number; isRequired: boolean };
type WorkOrderTemplate = { id: string; workflowStageId: string; title: string; description: string | null; department: string | null; assigneeRole: string | null; priority: "blocker" | "high" | "normal" | "low"; isBlocking: boolean; position: number };
type Workflow = { id: string; name: string; description: string | null; stages: Stage[]; rules: Rule[]; workOrderTemplates: WorkOrderTemplate[] };

export function WorkflowTemplateEditor({ workflow }: { workflow: Workflow }) {
  const router = useRouter();
  const [stages, setStages] = useState(workflow.stages);
  const [rules, setRules] = useState(workflow.rules);
  const [workOrderTemplates, setWorkOrderTemplates] = useState(workflow.workOrderTemplates);
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
    setRules((items) => [...items, { id: crypto.randomUUID(), workflowStageId, approverRole: null, label: `Sign-off slot ${approvalOrder}`, approvalOrder, isRequired: true }]);
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

  function moveStage(id: string, direction: -1 | 1) {
    setStages((items) => {
      const ordered = [...items].sort((a, b) => a.position - b.position);
      const index = ordered.findIndex((stage) => stage.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return items;
      const [moved] = ordered.splice(index, 1);
      ordered.splice(targetIndex, 0, moved);
      return ordered.map((stage, position) => ({ ...stage, position: position + 1 }));
    });
  }

  function addStage() {
    setStages((items) => {
      let sequence = items.length + 1;
      let key = `stage_${sequence}`;
      while (items.some((stage) => stage.key === key)) {
        sequence += 1;
        key = `stage_${sequence}`;
      }
      return [...items, { id: crypto.randomUUID(), name: "New stage", key, position: items.length + 1, color: "#687a78", isTerminal: false, canStartEarly: false, requiresQcPass: false, deliveryGate: "none" }];
    });
  }

  function removeStage(id: string) {
    const stage = stages.find((item) => item.id === id);
    if (!stage) return;
    if (stage.requiresQcPass && stages.filter((item) => item.requiresQcPass).length === 1) {
      setMessage("The QC workflow stage cannot be deleted.");
      return;
    }
    if (stages.length === 1) {
      setMessage("A workflow must have at least one stage.");
      return;
    }
    setStages((items) => items.filter((item) => item.id !== id).sort((a, b) => a.position - b.position).map((item, index) => ({ ...item, position: index + 1 })));
    setRules((items) => items.filter((item) => item.workflowStageId !== id));
    setWorkOrderTemplates((items) => items.filter((item) => item.workflowStageId !== id));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workflow.name, description: workflow.description, stages, rules, workOrderTemplates }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not save the workflow.");
      setMessage("Workflow saved. Assign named people to the sign-off slots in each episode team.");
      router.refresh();
    } catch {
      setMessage("Could not save the workflow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-[#e5e6e1] bg-[#fafaf8] px-4 py-3 text-xs leading-5 text-[#7d837f]">This is your organization’s single workflow. Stages are sequential by default; allow an early start only where your facility has agreed that work can begin before its normal turn. Existing sign-offs remain as recorded.</p>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebeae6] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[#353b39]">Workflow stages and sign-off slots</h2>
            <p className="mt-1 text-xs text-[#858a87]">Drag stages to set the order. Add the named-person sign-off slots each stage needs.</p>
          </div>
          <Button size="sm" variant="tertiary" onPress={addStage} className="border border-[#dfe5e1] bg-white text-[#45685e]"><Plus size={14} /> Add stage</Button>
        </div>
        <div className="divide-y divide-[#efeeea]">
          {[...stages].sort((a, b) => a.position - b.position).map((stage) => {
            const stageRules = rules.filter((rule) => rule.workflowStageId === stage.id).sort((a, b) => a.approvalOrder - b.approvalOrder);
            const isOnlyQcGate = stage.requiresQcPass && stages.filter((item) => item.requiresQcPass).length === 1;
            return (
              <div key={stage.id} onDragOver={(event) => { event.preventDefault(); if (draggedStageId !== stage.id) setDropTargetId(stage.id); }} onDrop={() => { reorderStages(stage.id); setDraggedStageId(null); setDropTargetId(null); }} className={`p-5 transition-colors ${dropTargetId === stage.id ? "bg-[#edf3ef]" : ""}`}>
                <div className="grid gap-3 md:grid-cols-[32px_minmax(220px,1fr)_auto]">
                  <button type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedStageId(stage.id); }} onDragEnd={() => { setDraggedStageId(null); setDropTargetId(null); }} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); moveStage(stage.id, -1); } if (event.key === "ArrowDown") { event.preventDefault(); moveStage(stage.id, 1); } }} className="mt-5 cursor-grab touch-none self-start rounded p-1 text-[#7d837f] hover:bg-[#efeeea] hover:text-[#353b39] active:cursor-grabbing" aria-label={`Drag to reorder ${stage.name}`} aria-keyshortcuts="ArrowUp ArrowDown" title="Drag to reorder, or use the up and down arrow keys"><GripVertical size={17} /></button>
                  <label className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d837f]">Stage name<input value={stage.name} onChange={(event) => updateStage(stage.id, { name: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#dedfda] px-2 text-sm normal-case tracking-normal" /></label>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-2 text-xs font-medium text-[#59615e]"><label className="flex items-center gap-2"><input type="checkbox" role="switch" aria-label={`Allow ${stage.name} to start early`} aria-checked={stage.canStartEarly} checked={stage.canStartEarly} onChange={(event) => updateStage(stage.id, { canStartEarly: event.target.checked })} /> Allow early start</label><label className="flex items-center gap-2"><input type="checkbox" role="switch" aria-label={`Require passed QC for ${stage.name}`} aria-checked={stage.requiresQcPass} checked={stage.requiresQcPass} disabled={isOnlyQcGate} onChange={(event) => updateStage(stage.id, { requiresQcPass: event.target.checked })} /> Require passed QC{isOnlyQcGate ? " · required" : ""}</label><label className="flex items-center gap-2">Delivery gate<select aria-label={`Delivery manifest gate for ${stage.name}`} value={stage.deliveryGate} onChange={(event) => updateStage(stage.id, { deliveryGate: event.target.value as Stage["deliveryGate"] })} className="h-8 rounded-md border border-[#dedfda] bg-white px-2 text-xs"><option value="none">None</option><option value="facility_dispatch">Facility dispatch</option><option value="client_acceptance">Client/network acceptance</option></select></label><label className="flex items-center gap-2"><input type="checkbox" role="switch" aria-label={`Mark ${stage.name} as terminal`} aria-checked={stage.isTerminal} checked={stage.isTerminal} onChange={(event) => updateStage(stage.id, { isTerminal: event.target.checked })} /> Terminal stage</label><Button isIconOnly size="sm" variant="tertiary" onPress={() => removeStage(stage.id)} isDisabled={isOnlyQcGate || stages.length === 1} aria-label={`Delete ${stage.name}${isOnlyQcGate ? " (the required QC stage cannot be deleted)" : ""}`} className="text-[#a35e41]"><Trash2 size={15} /></Button></div>
                </div>
                {(stage.canStartEarly || stage.requiresQcPass || stage.deliveryGate !== "none") && <p className="mt-2 text-xs leading-5 text-[#68716d]">{stage.canStartEarly ? "This stage may start before its normal turn when an authorised early start is recorded. " : ""}{stage.requiresQcPass ? "A passed or authorised-waived QC report is required before this stage can progress. " : ""}{stage.deliveryGate === "facility_dispatch" ? "Every required manifest item must pass required QC and be dispatched before sign-off." : ""}{stage.deliveryGate === "client_acceptance" ? "Every required item needs recipient receipt confirmation, unless a capability-authorised local exception is recorded." : ""}</p>}
                <div className="mt-4 rounded-lg bg-[#fafaf8] p-3">
                  <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d837f]">Sign-off slots</p><Button size="sm" variant="tertiary" onClick={() => addApprovalRule(stage.id)} className="h-7 border border-[#dfe5e1] bg-white px-2 text-xs text-[#45685e]"><Plus size={13} /> Add sign-off</Button></div>
                  <p className="mt-1 text-xs text-[#858a87]">Assign a named episode-team person to each slot in Edit episode. Required slots hold the next stage; optional slots do not.</p>
                  {stageRules.map((rule, index) => (
                    <div key={rule.id} className="mt-2 grid gap-2 sm:grid-cols-[28px_minmax(170px,1fr)_100px_28px] sm:items-center">
                      <span className="text-center text-xs font-semibold text-[#7c837f]">{index + 1}</span>
                      <input aria-label={`Sign-off slot ${index + 1}`} value={rule.label} onChange={(event) => updateRule(rule.id, { label: event.target.value })} placeholder="e.g. Creative approval" className="h-8 rounded-md border border-[#dedfda] bg-white px-2 text-xs" />
                      <label className="flex h-8 items-center gap-2 whitespace-nowrap text-xs font-medium text-[#59615e]"><input type="checkbox" aria-label={`Require sign-off ${index + 1}`} checked={rule.isRequired} onChange={(event) => updateRule(rule.id, { isRequired: event.target.checked })} /> Required</label>
                      <button type="button" onClick={() => removeApprovalRule(rule.id, stage.id)} className="rounded p-1 text-[#8b918e] hover:bg-[#f3e9e4] hover:text-[#a35e41]" aria-label={`Remove sign-off ${index + 1}`}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  {!stageRules.length && <p className="mt-2 text-xs text-[#858a87]">No sign-off slots configured for this stage.</p>}
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
