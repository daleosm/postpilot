"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const optionalSelectId = z.preprocess((value) => value === "" ? null : value, z.string().uuid().nullable().optional());
const optionalDate = z.preprocess((value) => value === "" ? null : value, z.coerce.date().nullable().optional());
const formSchema = z.object({
  clientCompanyId: z.string().uuid("Select a client account."), showId: optionalSelectId, episodeId: optionalSelectId,
  poNumber: z.string().trim().min(1, "PO number is required.").max(120), approvedAmount: z.coerce.number().positive("Authorised value must be greater than zero."),
  issueDate: optionalDate, expiryDate: optionalDate, notes: z.string().trim().max(8000).nullable().optional(),
  externalDocumentUrl: z.preprocess((value) => value === "" ? null : value, z.string().url("Enter a valid URL.").max(2000).nullable().optional()),
}).superRefine((value, context) => { if (value.issueDate && value.expiryDate && value.expiryDate < value.issueDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry date cannot be before the issue date." }); });
type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;
type ClientPurchaseOrder = { id: string; clientCompanyId: string; showId: string | null; episodeId: string | null; poNumber: string; approvedAmount: string | number; issueDate: string | Date | null; expiryDate: string | Date | null; notes: string | null; externalDocumentUrl: string | null; status: string };
type Client = { id: string; name: string };
type Show = { id: string; title: string };
type Episode = { id: string; showId: string; showTitle: string; number: number; title: string };

function dateInput(value: string | Date | null | undefined) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); }

export function ClientPurchaseOrderForm({ currency, clients, shows, episodes, purchaseOrder }: { currency: string; clients: Client[]; shows: Show[]; episodes: Episode[]; purchaseOrder?: ClientPurchaseOrder }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedShowId, setSelectedShowId] = useState(purchaseOrder?.showId ?? "");
  const defaults = (): FormInput => ({ clientCompanyId: purchaseOrder?.clientCompanyId ?? "", showId: purchaseOrder?.showId ?? "", episodeId: purchaseOrder?.episodeId ?? "", poNumber: purchaseOrder?.poNumber ?? "", approvedAmount: purchaseOrder ? Number(purchaseOrder.approvedAmount) : 0, issueDate: dateInput(purchaseOrder?.issueDate), expiryDate: dateInput(purchaseOrder?.expiryDate), notes: purchaseOrder?.notes ?? "", externalDocumentUrl: purchaseOrder?.externalDocumentUrl ?? "" });
  const form = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaults() });
  const visibleEpisodes = episodes.filter((episode) => !selectedShowId || episode.showId === selectedShowId);
  function close() { setOpen(false); setSubmitError(null); setSelectedShowId(purchaseOrder?.showId ?? ""); form.reset(defaults()); }
  async function submit(values: FormValues) {
    setSubmitError(null);
    const response = await fetch(purchaseOrder ? `/api/client-purchase-orders/${purchaseOrder.id}` : "/api/client-purchase-orders", { method: purchaseOrder ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!response.ok) { const body = await response.json().catch(() => null); setSubmitError(body?.error ?? "Unable to save this client purchase order."); return; }
    const saved = await response.json(); close();
    if (!purchaseOrder && saved?.id) router.push(`/budget/client-purchase-orders/${saved.id}`); else router.refresh();
  }
  return <>
    <Button variant={purchaseOrder ? "tertiary" : "primary"} size={purchaseOrder ? "sm" : "md"} onPress={() => setOpen(true)} className={purchaseOrder ? "border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>{purchaseOrder ? <><Pencil size={14}/> Edit client PO</> : <><Plus size={16}/> New client PO</>}</Button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"><form className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#e2e3de] bg-[#fafbf9] p-5 shadow-xl sm:rounded-xl sm:p-6" onSubmit={form.handleSubmit(submit)}>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-.03em] text-[#29322f]">{purchaseOrder ? "Edit draft client PO" : "New client PO"}</h2><p className="mt-1 text-sm text-[#747977]">Client authority to bill approved work in {currency}. This does not create or schedule a booking.</p></div><Button type="button" isIconOnly variant="tertiary" onPress={close} aria-label="Close client purchase order form" className="min-w-0 text-[#727b76]"><X size={18}/></Button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Client account" error={form.formState.errors.clientCompanyId?.message}><select {...form.register("clientCompanyId")} className="control"><option value="">Select client account</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field><Field label="Client PO number" error={form.formState.errors.poNumber?.message}><input {...form.register("poNumber")} className="control" placeholder="CLIENT-PO-2026-014"/></Field><Field label={`Authorised value (${currency})`} error={form.formState.errors.approvedAmount?.message}><input type="number" min="0.01" step="0.01" inputMode="decimal" {...form.register("approvedAmount")} className="control" placeholder="0.00"/></Field><Field label="Show"><select {...form.register("showId", { onChange: (event) => setSelectedShowId(event.target.value) })} className="control"><option value="">All shows / client retainer</option>{shows.map((show) => <option key={show.id} value={show.id}>{show.title}</option>)}</select></Field><Field label="Episode"><select {...form.register("episodeId", { onChange: (event) => { const episode = episodes.find((item) => item.id === event.target.value); if (episode) { form.setValue("showId", episode.showId); setSelectedShowId(episode.showId); } } })} className="control"><option value="">No specific episode</option>{visibleEpisodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.showTitle} · E{String(episode.number).padStart(2, "0")} {episode.title}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Issue date" error={form.formState.errors.issueDate?.message}><input type="date" {...form.register("issueDate")} className="control"/></Field><Field label="Expiry date" error={form.formState.errors.expiryDate?.message}><input type="date" {...form.register("expiryDate")} className="control"/></Field></div></div>
      <div className="mt-4 space-y-4"><Field label="Notes" error={form.formState.errors.notes?.message}><textarea rows={3} {...form.register("notes")} className="control" placeholder="Approved scope, client authorisation, or finance note."/></Field><Field label="Supporting document link" error={form.formState.errors.externalDocumentUrl?.message}><input type="url" {...form.register("externalDocumentUrl")} className="control" placeholder="https://…"/></Field></div>{submitError && <p role="alert" className="mt-4 rounded-lg bg-[#f9e7df] px-3 py-2 text-sm text-[#9f563c]">{submitError}</p>}<div className="mt-6 flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={close}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : purchaseOrder ? "Save draft" : "Create draft client PO"}</Button></div>
    </form></div>}
  </>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-[#48514d]"><span>{label}</span><div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#a65f42]">{error}</span>}</label>; }
