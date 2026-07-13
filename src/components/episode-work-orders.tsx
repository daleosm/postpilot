"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { ExternalLink, Plus, Save, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

type WorkOrder = { id: string; workflowStageId: string | null; workflowStageName: string | null; kind: string; title: string; description: string | null; department: string | null; assigneePersonId: string | null; assigneeName: string | null; assigneeRole: string | null; priority: string; isBlocking: boolean; status: string; billingScope: string; billingStatus: string; estimatedAmount: string | number | null; actualAmount: string | number | null; currency: string; billingNotes: string | null; budgetLineId: string | null; externalUrl: string | null; dueAt: Date | string | null; completedAt: Date | string | null };
type Person = { id: string; name: string; role: string };

const workOrderSchema = z.object({
  workflowStageId: z.string().optional(),
  title: z.string().trim().min(2, "Enter a short work-order title.").max(160),
  description: z.string().trim().max(4000).optional(),
  department: z.string().trim().max(120).optional(),
  assigneePersonId: z.string().optional(),
  assigneeRole: z.string().optional(),
  priority: z.enum(["blocker", "high", "normal", "low"]),
  isBlocking: z.boolean(),
  billingScope: z.enum(["included", "billable_change", "internal"]),
  estimatedAmount: z.union([z.literal(""), z.coerce.number().nonnegative("Estimate cannot be negative.")]),
  currency: z.string().trim().length(3, "Use a three-letter currency code."),
  billingNotes: z.string().trim().max(2000).optional(),
  externalUrl: z.union([z.literal(""), z.string().url("Enter a valid external link.")]),
  dueAt: z.string().optional(),
});
type WorkOrderValues = z.infer<typeof workOrderSchema>;
type WorkOrderInput = z.input<typeof workOrderSchema>;

export function EpisodeWorkOrders({ episodeId, initialWorkOrders, people, stages, currentStageId, canManage, canUpdate }: { episodeId: string; initialWorkOrders: WorkOrder[]; people: Person[]; stages: readonly { id: string; name: string; position: number }[]; currentStageId: string | null; canManage: boolean; canUpdate: boolean }) {
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState(initialWorkOrders);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const form = useForm<WorkOrderInput, unknown, WorkOrderValues>({ resolver: zodResolver(workOrderSchema), defaultValues: { workflowStageId: currentStageId ?? "", title: "", description: "", department: "", assigneePersonId: "", assigneeRole: "", priority: "normal", isBlocking: false, billingScope: "included", estimatedAmount: "", currency: "USD", billingNotes: "", externalUrl: "", dueAt: "" } });
  const roles = [...new Set(people.map((person) => person.role))].sort();
  const selectedWorkflowStageId = useWatch({ control: form.control, name: "workflowStageId" });
  const billingScope = useWatch({ control: form.control, name: "billingScope" });

  async function create(values: WorkOrderValues) {
    setMessage("");
    const response = await fetch("/api/work-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, episodeId, workflowStageId: values.workflowStageId || null, assigneePersonId: values.assigneePersonId || null, assigneeRole: values.assigneeRole || null, description: values.description || null, department: values.department || null, estimatedAmount: values.estimatedAmount === "" ? null : values.estimatedAmount, billingNotes: values.billingNotes || null, externalUrl: values.externalUrl || null, dueAt: values.dueAt || null }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setMessage(body?.error ?? "Could not create the work order."); return; }
    setOpen(false); form.reset({ workflowStageId: currentStageId ?? "", title: "", description: "", department: "", assigneePersonId: "", assigneeRole: "", priority: "normal", isBlocking: false, billingScope: "included", estimatedAmount: "", currency: "USD", billingNotes: "", externalUrl: "", dueAt: "" }); setMessage("Work order created."); router.refresh();
  }

  async function updateStatus(id: string, status: string) {
    setMessage("");
    const response = await fetch(`/api/work-orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setMessage(body?.error ?? "Could not update the work order."); return; }
    setWorkOrders((items) => items.map((item) => item.id === id ? { ...item, status, completedAt: status === "complete" ? new Date() : null } : item));
    setMessage(status === "complete" ? "Work order completed." : "Work order updated."); router.refresh();
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-[#414a46]">Episode work orders</p><p className="mt-1 text-xs text-[#818783]">Practical post work, separate from workflow authorisation.</p></div>{canManage && <Button variant="primary" onPress={() => setOpen((value) => !value)} className="bg-[#263130] text-white"><Plus size={15} /> New work order</Button>}</div>
    {open && <form onSubmit={form.handleSubmit(create)} className="rounded-lg border border-[#dfe4df] bg-[#f7f9f7] p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="Title" error={form.formState.errors.title?.message}><input {...form.register("title")} placeholder="Correct captions at act break" /></Field><Field label="Workflow scope"><select {...form.register("workflowStageId", { onChange: (event) => { if (!event.target.value) form.setValue("isBlocking", false); } })}><option value="">Episode-wide — not tied to a stage</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.position}. {stage.name}{stage.id === currentStageId ? " (current)" : ""}</option>)}</select></Field><Field label="Department"><input {...form.register("department")} placeholder="Online / captions / VFX…" /></Field><Field label="Assigned person"><select {...form.register("assigneePersonId")}><option value="">Unassigned</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role.replaceAll("_", " ")}</option>)}</select></Field><Field label="Or assigned role"><select {...form.register("assigneeRole")}><option value="">No role assignment</option>{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></Field><Field label="Priority"><select {...form.register("priority")}><option value="blocker">Blocker</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></Field><Field label="Billing scope"><select {...form.register("billingScope")}><option value="included">Included in agreed scope</option><option value="billable_change">Billable client change</option><option value="internal">Internal / non-billable</option></select></Field>{billingScope === "billable_change" && <><Field label="Quoted change value" error={form.formState.errors.estimatedAmount?.message}><input type="number" min="0" step="0.01" inputMode="decimal" {...form.register("estimatedAmount")} placeholder="0.00" /></Field><Field label="Currency" error={form.formState.errors.currency?.message}><input {...form.register("currency")} /></Field></>}<Field label="Due"><input type="datetime-local" {...form.register("dueAt")} /></Field><Field label="External reference"><input {...form.register("externalUrl")} placeholder="https://facility-system.example/item" /></Field><label className={`flex items-end gap-2 pb-2 text-xs font-medium ${selectedWorkflowStageId ? "text-[#535b57]" : "text-[#9a9f9c]"}`}><input type="checkbox" disabled={!selectedWorkflowStageId} {...form.register("isBlocking")} /> Block this stage&apos;s sign-off</label></div>{billingScope === "billable_change" && <Field label="Budget note / client change reference"><input {...form.register("billingNotes")} placeholder="Approved change order, PO, or client reference" /></Field>}<Field label="Description"><textarea rows={3} {...form.register("description")} placeholder="Include timecode, context, or a link to the facility system." /></Field><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs text-[#7f8582]">Defaults to the current stage. Choose another stage or episode-wide for coordination work; only stage-linked blockers hold up sign-off. Billable changes need a user with the Budget permission to confirm the charge after completion.</p><div className="flex gap-2"><Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white"><Save size={14} /> {form.formState.isSubmitting ? "Saving…" : "Create"}</Button></div></div></form>}
    <div className="divide-y divide-[#ecece8] rounded-lg border border-[#e8e8e4]">{workOrders.map((item) => <article key={item.id} className="p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[#3d4642]">{item.title}</p>{item.isBlocking && <span className="inline-flex items-center gap-1 rounded-full bg-[#f8e8df] px-2 py-0.5 text-[10px] font-semibold text-[#a15e42]"><ShieldAlert size={11} /> Blocks sign-off</span>}<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.status === "complete" ? "bg-[#e4efe9] text-[#477665]" : "bg-[#edf0ed] text-[#65716c]"}`}>{item.status.replaceAll("_", " ")}</span>{item.billingScope === "billable_change" && <span className="rounded-full bg-[#e7eff0] px-2 py-0.5 text-[10px] font-semibold text-[#4f7275]">Client change · {item.billingStatus.replaceAll("_", " ")}</span>}</div><p className="mt-1 text-xs text-[#737b77]">{item.workflowStageName ?? "Episode work"} · {item.assigneeName ?? (item.assigneeRole ? item.assigneeRole.replaceAll("_", " ") : "Unassigned")} · {item.priority}</p>{item.billingScope === "billable_change" && <p className="mt-1 text-xs text-[#65716c]">Quoted {formatMoney(item.estimatedAmount, item.currency)}{item.actualAmount !== null ? ` · Posted ${formatMoney(item.actualAmount, item.currency)}` : ""}{item.billingNotes ? ` · ${item.billingNotes}` : ""}</p>}{item.description && <p className="mt-2 text-xs leading-5 text-[#626b66]">{item.description}</p>}{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#4f756b] hover:underline"><ExternalLink size={12} /> Open external reference</a>}</div>{canUpdate && <select aria-label={`Update ${item.title} status`} value={item.status} onChange={(event) => updateStatus(item.id, event.target.value)} className="h-8 rounded-md border border-[#dfe1dc] px-2 text-xs"><option value="open">Open</option><option value="in_progress">In progress</option><option value="ready_for_review">Ready for re-QC</option>{item.kind !== "qc_exception" && <option value="complete">Complete</option>}<option value="cancelled">Cancelled</option></select>}</div></article>)}{!workOrders.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No work orders for this episode yet.</p>}</div>
    {message && <p role="status" className={`text-xs ${message.includes("Could not") || message.includes("only") ? "text-[#a35e41]" : "text-[#4d8068]"}`}>{message}</p>}
  </div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-9 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:px-2 [&_input]:text-xs [&_select]:h-9 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:px-2 [&_select]:text-xs [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:p-2 [&_textarea]:text-xs">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>; }

function formatMoney(value: string | number | null, currency: string) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}
