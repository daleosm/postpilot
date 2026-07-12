"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const episodeFormSchema = z.object({
  seasonId: z.string().min(1, "Select a season."),
  number: z.coerce.number().int().positive("Episode number must be at least 1."),
  title: z.string().trim().min(1, "Enter an episode title.").max(160),
  productionCode: z.string().trim().max(40).optional(),
  status: z.enum(["development", "assembly", "editor_cut", "review", "locked", "online", "delivered"]),
  airDate: z.string().optional(),
  deliveryDeadline: z.string().optional(),
});
type Values = z.infer<typeof episodeFormSchema>;
export type EpisodeSeason = { id: string; label: string };

export function EpisodeFormDialog({ seasons, defaultSeasonId }: { seasons: EpisodeSeason[]; defaultSeasonId?: string }) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const form = useForm<z.input<typeof episodeFormSchema>, unknown, Values>({ resolver: zodResolver(episodeFormSchema), defaultValues: defaults(defaultSeasonId) });

  useEffect(() => { form.reset(defaults(defaultSeasonId)); }, [defaultSeasonId, form]);

  async function submit(values: Values) {
    setSubmitError(null);
    try {
      const response = await fetch("/api/episodes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        seasonId: values.seasonId,
        number: values.number,
        title: values.title,
        productionCode: values.productionCode || null,
        status: values.status,
        workflowStageId: null,
        assignedProducerId: null,
        editorId: null,
        coloristId: null,
        soundMixerId: null,
        synopsis: null,
        qcStatus: "not_started",
        airDate: values.airDate ? `${values.airDate}T12:00:00.000Z` : null,
        lockedCutDate: null,
        deliveryDeadline: values.deliveryDeadline ? new Date(values.deliveryDeadline).toISOString() : null,
      }) });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSubmitError(body?.error ?? "Unable to create the episode.");
        return;
      }
      setOpen(false);
      form.reset(defaults(defaultSeasonId));
      router.refresh();
    } catch {
      setSubmitError("Unable to create the episode. Check your connection and try again.");
    }
  }

  return <><Button variant="primary" onClick={() => setOpen(true)} isDisabled={!seasons.length} className="bg-[#263130] text-white"><Plus size={16} /> New episode</Button>{open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"><form onSubmit={form.handleSubmit(submit)} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#29322f]">New episode</h2><p className="mt-1 text-sm text-[#747977]">Create an episode in the selected show season.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-[#727b76] hover:bg-[#f2f2ef]" aria-label="Close"><X size={18} /></button></div><div className="mt-5 space-y-4"><Field label="Season" error={form.formState.errors.seasonId?.message}><select {...form.register("seasonId")} className="control"><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-[120px_1fr]"><Field label="Episode number" error={form.formState.errors.number?.message}><input type="number" min="1" {...form.register("number")} className="control" /></Field><Field label="Title" error={form.formState.errors.title?.message}><input {...form.register("title")} placeholder="e.g. The Final Cut" className="control" /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Production code" error={form.formState.errors.productionCode?.message}><input {...form.register("productionCode")} placeholder="e.g. SN109" className="control" /></Field><Field label="Initial workflow status" error={form.formState.errors.status?.message}><select {...form.register("status")} className="control">{["development", "assembly", "editor_cut", "review", "locked", "online", "delivered"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Air date" error={form.formState.errors.airDate?.message}><input type="date" {...form.register("airDate")} className="control" /></Field><Field label="Delivery deadline" error={form.formState.errors.deliveryDeadline?.message}><input type="datetime-local" {...form.register("deliveryDeadline")} className="control" /></Field></div></div>{submitError && <p role="alert" className="mt-4 rounded-lg bg-[#f9e7df] px-3 py-2 text-sm text-[#9f563c]">{submitError}</p>}<div className="mt-6 flex justify-end gap-2"><Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Creating…" : "Create episode"}</Button></div></form></div>}</>;
}

function defaults(seasonId?: string) { return { seasonId: seasonId ?? "", number: 1, title: "", productionCode: "", status: "development" as const, airDate: "", deliveryDeadline: "" }; }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-[#48514d]"><span>{label}</span><div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#a65f42]">{error}</span>}</label>; }
