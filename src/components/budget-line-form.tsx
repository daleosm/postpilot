"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { postpilotApiFetch } from "@/lib/postpilot-api-client";

const schema = z.object({
  episodeId: z.string().min(1, "Select an episode."),
  category: z.string().trim().min(2, "Enter a cost category."),
  description: z.string().trim().min(1, "Enter a description."),
  budgetedAmount: z.coerce.number().nonnegative("Estimate cannot be negative."),
  plannedQuantity: z.coerce.number().positive("Quantity must be greater than zero.").optional(),
  plannedUnit: z.enum(["hour", "day", "episode", "fixed", "unit"]).optional(),
  rateResource: z.string().optional(),
  costType: z.enum(["billable", "internal"]),
  externalCost: z.boolean(),
  purchaseOrderId: z.string().uuid().nullable(),
});
type Values = z.infer<typeof schema>;
type BudgetLine = { id: string; episodeId: string | null; category: string; description: string | null; budgetedAmount: string | number; actualAmount: string | number; costType: string; externalCost: boolean; purchaseOrderId: string | null };
type PurchaseOrderOption = { id: string; poNumber: string; vendorName: string | null; showId: string | null; episodeId: string | null; status: string; remainingAmount: number; currency: string };
type RateResources = { services: Array<{ id: string; name: string; category: string; unit: string }>; rooms: Array<{ id: string; name: string; type: string }>; people: Array<{ id: string; name: string; role: string }> };

export function BudgetLineForm({ episodes, currency, purchaseOrders, resources, line, locked = false }: { episodes: Array<{ id: string; label: string; showId?: string }>; currency: string; purchaseOrders: PurchaseOrderOption[]; resources: RateResources; line?: BudgetLine; locked?: boolean }) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const defaults = () => ({ episodeId: line?.episodeId ?? (episodes.length === 1 ? episodes[0].id : ""), category: line?.category ?? "", description: line?.description ?? "", budgetedAmount: line ? Number(line.budgetedAmount) : 0, plannedQuantity: undefined, plannedUnit: undefined, rateResource: undefined, costType: (line?.costType === "billable" ? "billable" : "internal") as Values["costType"], externalCost: line?.externalCost ?? false, purchaseOrderId: line?.purchaseOrderId ?? null });
  const form = useForm<z.input<typeof schema>, unknown, Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const [externalCost, selectedEpisodeId, rateResource] = useWatch({ control: form.control, name: ["externalCost", "episodeId", "rateResource"] });
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId);
  const eligiblePurchaseOrders = purchaseOrders.filter((order) => order.status === "approved" && (!order.showId || !selectedEpisode?.showId || order.showId === selectedEpisode.showId) && (!order.episodeId || order.episodeId === selectedEpisodeId));
  const chooseRateResource = (value: string) => {
    const [type, id] = value.split(":");
    if (type !== "service" || !id) return;
    const service = resources.services.find((item) => item.id === id);
    if (service) {
      form.setValue("category", service.category, { shouldValidate: true });
      form.setValue("plannedUnit", service.unit as Values["plannedUnit"], { shouldValidate: true });
    }
  };

  async function submit(values: Values) {
    setSubmitError(null);
    try {
      const [rateResourceType, rateResourceId] = values.rateResource?.split(":") ?? [];
      const payload = { ...values, purchaseOrderId: values.externalCost ? values.purchaseOrderId : null };
      await postpilotApiFetch(line ? `/budget/lines/${line.id}` : "/budget/lines", {
        method: line ? "PATCH" : "POST",
        body: {
          ...(line ? {} : { episode_id: payload.episodeId }),
          category: payload.category,
          description: payload.description || null,
          budgeted_amount: payload.budgetedAmount,
          planned_quantity: rateResourceId ? payload.plannedQuantity : undefined,
          planned_unit: rateResourceId ? payload.plannedUnit : undefined,
          rate_resource_type: rateResourceType,
          rate_resource_id: rateResourceId,
          cost_type: payload.costType,
          external_cost: payload.externalCost,
          purchase_order_id: payload.purchaseOrderId,
        },
      });
      form.reset(defaults());
      setOpen(false);
      router.refresh();
    } catch {
      setSubmitError("Unable to save this budget line. Check your connection and try again.");
    }
  }

  async function remove() {
    if (!line || !window.confirm("Remove this budget line?")) return;
    setSubmitError(null);
    try { await postpilotApiFetch(`/budget/lines/${line.id}`, { method: "DELETE" }); }
    catch (error) { setSubmitError(error instanceof Error ? error.message : "Unable to remove this budget line."); return; }
    setOpen(false); router.refresh();
  }

  return <>
    <Button variant={line ? "tertiary" : "primary"} size={line ? "sm" : "md"} onPress={() => setOpen(true)} isDisabled={episodes.length === 0 || locked} aria-label={locked ? "Estimate locked. Create a revision before changing planned costs." : undefined} className={line ? "min-w-0 border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>{line ? "Edit" : <><Plus size={16} /> Add episode budget</>}</Button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
      <form onSubmit={form.handleSubmit(submit)} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#fafbf9] p-5 shadow-xl sm:rounded-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#29322f]">{line ? "Edit episode budget line" : "Add episode budget line"}</h2><p className="mt-1 text-sm text-[#747977]">Costs are assigned to an episode and roll up to its show.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-[#727b76] hover:bg-[#f2f2ef]" aria-label="Close"><X size={18} /></button></div>
        <div className="mt-5 space-y-4">
          <Field label="Episode" error={form.formState.errors.episodeId?.message}><select {...form.register("episodeId")} className="control"><option value="">Select episode</option>{episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Category" error={form.formState.errors.category?.message}><input {...form.register("category")} placeholder="e.g. Sound" className="control" /></Field><Field label="Cost type" error={form.formState.errors.costType?.message}><select {...form.register("costType")} className="control"><option value="internal">Internal</option><option value="billable">Billable</option></select></Field></div>
          <Field label="Description" error={form.formState.errors.description?.message}><input {...form.register("description")} placeholder="e.g. Final mix and audio stems" className="control" /></Field>
          <Field label="Rate resource (optional)"><select {...form.register("rateResource", { onChange: (event) => chooseRateResource(event.target.value) })} className="control"><option value="">Manual estimate</option><optgroup label="Services">{resources.services.map((item) => <option key={item.id} value={`service:${item.id}`}>{item.name} · {item.category} / {item.unit}</option>)}</optgroup><optgroup label="Rooms">{resources.rooms.map((item) => <option key={item.id} value={`room:${item.id}`}>{item.name} · {item.type.replaceAll("_", " ")}</option>)}</optgroup><optgroup label="People">{resources.people.map((item) => <option key={item.id} value={`person:${item.id}`}>{item.name} · {item.role.replaceAll("_", " ")}</option>)}</optgroup></select></Field>
          {rateResource ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Planned quantity" error={form.formState.errors.plannedQuantity?.message}><input type="number" min="0.01" step="0.01" inputMode="decimal" {...form.register("plannedQuantity")} className="control" /></Field><Field label="Unit" error={form.formState.errors.plannedUnit?.message}><select {...form.register("plannedUnit")} className="control"><option value="">Select unit</option>{[["hour", "Hour"], ["half_day", "Half-day"], ["day", "Day"], ["week", "Week"], ["fixed", "Fixed fee"], ["unit", "Unit"], ["episode", "Per episode"]].map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select></Field><p className="sm:col-span-2 -mt-2 text-xs text-[#858a87]">The server resolves the inherited rate and calculates the estimate when saved.</p></div> : <Field label={`Estimated cost (${currency})`} error={form.formState.errors.budgetedAmount?.message}><input type="number" min="0" step="0.01" inputMode="decimal" {...form.register("budgetedAmount")} className="control" /><p className="mt-1 text-xs font-normal text-[#858a87]">Actual cost is calculated from linked time, work, invoice, or approved adjustment records.</p></Field>}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e3e5e1] bg-white px-3 py-2.5 text-sm text-[#4f5954]"><input type="checkbox" {...form.register("externalCost")} className="h-4 w-4 accent-[#58756b]" /> External vendor cost</label>
          {externalCost && <Field label="Purchase order (optional)" error={form.formState.errors.purchaseOrderId?.message}><select {...form.register("purchaseOrderId", { setValueAs: (value) => value || null })} className="control"><option value="">No PO selected</option>{eligiblePurchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.poNumber} · {order.vendorName ?? "Vendor"} · {currency} {order.remainingAmount.toFixed(2)} remaining</option>)}</select><p className="mt-1 text-xs font-normal text-[#858a87]">Linking an approved PO reserves this line’s estimate as a commitment; it is not added to actual cost.</p></Field>}
        </div>
        {submitError && <p role="alert" className="mt-4 rounded-lg bg-[#f9e7df] px-3 py-2 text-sm text-[#9f563c]">{submitError}</p>}
        <div className="mt-6 flex justify-end gap-2">{line && <Button type="button" variant="tertiary" onPress={remove} className="text-[#a35e41]">Delete</Button>}<Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : "Save line"}</Button></div>
      </form>
    </div>}
  </>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-[#48514d]"><span>{label}</span><div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#a65f42]">{error}</span>}</label>;
}
