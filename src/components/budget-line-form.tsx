"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const categories = ["edit suite", "editor", "assistant editor", "color", "sound", "VFX", "QC", "finalisation", "storage", "overtime"] as const;
const schema = z.object({
  episodeId: z.string().min(1, "Select an episode."),
  category: z.enum(categories),
  description: z.string().trim().min(1, "Enter a description."),
  budgetedAmount: z.coerce.number().nonnegative("Estimate cannot be negative."),
  actualAmount: z.coerce.number().nonnegative("Actual cost cannot be negative."),
  costType: z.enum(["billable", "internal"]),
});
type Values = z.infer<typeof schema>;
type BudgetLine = { id: string; episodeId: string | null; category: string; description: string | null; budgetedAmount: string | number; actualAmount: string | number; costType: string };

export function BudgetLineForm({ episodes, currency, line }: { episodes: Array<{ id: string; label: string }>; currency: string; line?: BudgetLine }) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const defaults = () => ({ episodeId: line?.episodeId ?? "", category: (categories.includes(line?.category as (typeof categories)[number]) ? line?.category : "editor") as Values["category"], description: line?.description ?? "", budgetedAmount: line ? Number(line.budgetedAmount) : 0, actualAmount: line ? Number(line.actualAmount) : 0, costType: (line?.costType === "billable" ? "billable" : "internal") as Values["costType"] });
  const form = useForm<z.input<typeof schema>, unknown, Values>({ resolver: zodResolver(schema), defaultValues: defaults() });

  async function submit(values: Values) {
    setSubmitError(null);
    try {
      const response = await fetch(line ? `/api/budget-lines/${line.id}` : "/api/budget-lines", { method: line ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSubmitError(body?.error ?? "Unable to save this budget line.");
        return;
      }
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
    const response = await fetch(`/api/budget-lines/${line.id}`, { method: "DELETE" });
    if (!response.ok) { const body = await response.json().catch(() => null); setSubmitError(body?.error ?? "Unable to remove this budget line."); return; }
    setOpen(false); router.refresh();
  }

  return <>
    <Button variant={line ? "tertiary" : "primary"} size={line ? "sm" : "md"} onPress={() => setOpen(true)} isDisabled={episodes.length === 0} className={line ? "min-w-0 border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>{line ? "Edit" : <><Plus size={16} /> Add episode budget</>}</Button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
      <form onSubmit={form.handleSubmit(submit)} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#fafbf9] p-5 shadow-xl sm:rounded-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#29322f]">{line ? "Edit episode budget line" : "Add episode budget line"}</h2><p className="mt-1 text-sm text-[#747977]">Costs are assigned to an episode and roll up to its show.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-[#727b76] hover:bg-[#f2f2ef]" aria-label="Close"><X size={18} /></button></div>
        <div className="mt-5 space-y-4">
          <Field label="Episode" error={form.formState.errors.episodeId?.message}><select {...form.register("episodeId")} className="control"><option value="">Select episode</option>{episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Category" error={form.formState.errors.category?.message}><select {...form.register("category")} className="control">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field><Field label="Cost type" error={form.formState.errors.costType?.message}><select {...form.register("costType")} className="control"><option value="internal">Internal</option><option value="billable">Billable</option></select></Field></div>
          <Field label="Description" error={form.formState.errors.description?.message}><input {...form.register("description")} placeholder="e.g. Final mix and audio stems" className="control" /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label={`Estimated cost (${currency})`} error={form.formState.errors.budgetedAmount?.message}><input type="number" min="0" step="0.01" inputMode="decimal" {...form.register("budgetedAmount")} className="control" /></Field><Field label={`Actual cost (${currency})`} error={form.formState.errors.actualAmount?.message}><input type="number" min="0" step="0.01" inputMode="decimal" {...form.register("actualAmount")} className="control" /></Field></div>
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
