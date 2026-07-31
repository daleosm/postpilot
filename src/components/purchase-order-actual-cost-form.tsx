"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { postpilotApiFetch, postpilotUiFetch } from "@/lib/postpilot-api-client";

const schema = z.object({
  episodeId: z.string().uuid().nullable(),
  budgetLineId: z.string().uuid("Select the external budget item this supplier invoice actualises."),
  invoiceNumber: z.string().trim().min(1, "Enter the supplier invoice or reference number."),
  invoiceDate: z.string().min(1, "Enter the invoice date."),
  amount: z.coerce.number().positive("Enter a positive supplier cost."),
  description: z.string().trim().min(1, "Enter a short description."),
  externalDocumentUrl: z.union([z.string().url("Enter a valid document link."), z.literal("")]),
  overrunReason: z.string().trim().max(2000),
});
type Values = z.infer<typeof schema>;
type Episode = { id: string; showId: string; showTitle: string; number: number; title: string };

/** A PO-side actuals form; it deliberately has no payment or AP controls. */
export function PurchaseOrderActualCostForm({ purchaseOrderId, status, currency, episodeId, showId, episodes }: { purchaseOrderId: string; status: string; currency: string; episodeId: string | null; showId: string | null; episodes: Episode[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetItems, setBudgetItems] = useState<Array<{ id: string; category: string; description: string | null; estimatedAmount: string | number; currency: string }>>([]);
  const router = useRouter();
  const availableEpisodes = episodes.filter((episode) => !showId || episode.showId === showId);
  const form = useForm<z.input<typeof schema>, unknown, Values>({ resolver: zodResolver(schema), defaultValues: { episodeId, budgetLineId: "", invoiceNumber: "", invoiceDate: "", amount: 0, description: "", externalDocumentUrl: "", overrunReason: "" } });
  const selectedEpisodeId = useWatch({ control: form.control, name: "episodeId" });
  const effectiveEpisodeId = episodeId ?? selectedEpisodeId;
  useEffect(() => {
    if (!effectiveEpisodeId) return;
    let live = true;
    postpilotUiFetch(`/v1/budget/lines?episode_id=${encodeURIComponent(effectiveEpisodeId)}`)
      .then(async (response) => response.ok ? response.json() : { budgetLines: [] })
      .then((payload) => {
        if (live) setBudgetItems((payload.budgetLines ?? []).filter((item: { externalCost: boolean }) => item.externalCost));
      })
      .catch(() => { if (live) setBudgetItems([]); });
    return () => { live = false; };
  }, [effectiveEpisodeId]);
  if (!["approved", "closed"].includes(status)) return null;

  async function submit(values: Values) {
    setError(null);
    try {
      await postpilotApiFetch(`/purchase-orders/${purchaseOrderId}/actual-costs`, {
        method: "POST",
        body: {
          episode_id: episodeId ?? values.episodeId,
          budget_line_id: values.budgetLineId,
          invoice_number: values.invoiceNumber,
          invoice_date: values.invoiceDate,
          amount: values.amount,
          description: values.description,
          external_document_url: values.externalDocumentUrl || null,
          overrun_reason: values.overrunReason || null,
        },
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to record the supplier actual cost.");
      return;
    }
    form.reset({ episodeId, budgetLineId: "", invoiceNumber: "", invoiceDate: "", amount: 0, description: "", externalDocumentUrl: "", overrunReason: "" }); setOpen(false); router.refresh();
  }

  return <>
    <Button size="sm" variant="secondary" onPress={() => setOpen(true)} className="border border-[#dfe3df] bg-white text-[#4e615a]"><Plus size={14}/> Record supplier actual</Button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"><form onSubmit={form.handleSubmit(submit)} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#fafbf9] p-5 shadow-xl sm:rounded-xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#29322f]">Record supplier actual</h2><p className="mt-1 text-sm text-[#747977]">Posts this invoice to an existing external budget item. The PO remains a separate authorisation ledger.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-[#727b76] hover:bg-[#f2f2ef]" aria-label="Close"><X size={18}/></button></div><div className="mt-5 space-y-4">{!episodeId && <Field label="Episode" error={form.formState.errors.episodeId?.message}><select {...form.register("episodeId", { setValueAs: (value) => value || null })} className="control"><option value="">Select episode</option>{availableEpisodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.showTitle} · E{String(episode.number).padStart(2, "0")} {episode.title}</option>)}</select></Field>}<Field label="External budget item" error={form.formState.errors.budgetLineId?.message}><select {...form.register("budgetLineId")} className="control" disabled={!effectiveEpisodeId}><option value="">Select budget item</option>{budgetItems.map((item) => <option key={item.id} value={item.id}>{item.category} · {new Intl.NumberFormat("en-GB", { style: "currency", currency: item.currency }).format(Number(item.estimatedAmount))} estimate</option>)}</select><p className="mt-1 text-xs font-normal text-[#858a87]">Partial invoices can use the same item; each invoice is counted once.</p></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Supplier invoice / reference" error={form.formState.errors.invoiceNumber?.message}><input {...form.register("invoiceNumber")} className="control" placeholder="e.g. VND-1042"/></Field><Field label="Invoice date" error={form.formState.errors.invoiceDate?.message}><input type="date" {...form.register("invoiceDate")} className="control"/></Field></div><Field label="Description" error={form.formState.errors.description?.message}><input {...form.register("description")} className="control" placeholder="e.g. External caption correction"/></Field><Field label={`Actual supplier cost (${currency})`} error={form.formState.errors.amount?.message}><input type="number" min="0.01" step="0.01" inputMode="decimal" {...form.register("amount")} className="control"/></Field><Field label="Supporting document link (optional)" error={form.formState.errors.externalDocumentUrl?.message}><input type="url" {...form.register("externalDocumentUrl")} className="control" placeholder="https://…"/></Field><Field label="Overrun reason (only if this exceeds the PO)" error={form.formState.errors.overrunReason?.message}><textarea rows={2} {...form.register("overrunReason")} className="control" placeholder="Explain the approved supplier overrun."/></Field></div>{error && <p role="alert" className="mt-4 rounded-lg bg-[#f9e7df] px-3 py-2 text-sm text-[#9f563c]">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Recording…" : "Record actual"}</Button></div></form></div>}
  </>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-[#48514d]"><span>{label}</span><div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#a65f42]">{error}</span>}</label>; }
