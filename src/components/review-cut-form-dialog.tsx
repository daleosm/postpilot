"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { FilePlus2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const cutSchema = z.object({
  episodeId: z.string().min(1, "Choose an episode."),
  title: z.string().trim().min(1, "Cut title is required.").max(240),
  version: z.coerce.number().int().positive(),
  runtimeSeconds: z.coerce.number().positive().optional(),
  status: z.enum(["draft", "in_review"]),
  reviewDeadline: z.string().min(1, "Choose a review deadline."),
});
type CutValues = z.infer<typeof cutSchema>;
type CutFormInput = z.input<typeof cutSchema>;

export function ReviewCutFormDialog({ episodes }: { episodes: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<CutFormInput, unknown, CutValues>({
    resolver: zodResolver(cutSchema),
    defaultValues: { episodeId: "", title: "", version: 1, runtimeSeconds: 2640, status: "in_review", reviewDeadline: "" },
  });

  async function submit(values: CutValues) {
    setError("");
    const response = await fetch("/api/review-cuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId: values.episodeId,
        title: values.title,
        version: values.version,
        runtimeSeconds: values.runtimeSeconds ?? null,
        status: values.status,
        approvalStatus: "pending",
        dueAt: new Date(values.reviewDeadline).toISOString(),
        submittedAt: new Date().toISOString(),
      }),
    });
    if (!response.ok) return setError((await response.json()).error ?? "Could not register cut.");
    setOpen(false);
    form.reset();
    router.refresh();
  }

  return <><Button variant="primary" onClick={() => setOpen(true)} className="bg-[#263130] text-white"><FilePlus2 size={16} /> Register cut</Button>{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4"><div className="w-full max-w-lg rounded-xl border border-[#e2e3de] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">Register review cut</h2><p className="mt-1 text-sm text-[#767c78]">Record the version and review deadline. PostPilot never uploads, stores, or plays media.</p></div><Button isIconOnly variant="tertiary" onPress={() => setOpen(false)} className="min-w-0 text-[#7d827e] hover:bg-[#f0f1ed]" aria-label="Close"><X size={18} /></Button></div><form className="mt-6 space-y-4" onSubmit={form.handleSubmit(submit)}><Field label="Episode" error={form.formState.errors.episodeId?.message}><select {...form.register("episodeId")}><option value="">Choose episode</option>{episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></Field><div className="grid grid-cols-[1fr_100px] gap-3"><Field label="Cut title" error={form.formState.errors.title?.message}><input {...form.register("title")} placeholder="SN104 Director’s cut" /></Field><Field label="Version" error={form.formState.errors.version?.message}><input type="number" min="1" {...form.register("version")} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Runtime (seconds)" error={form.formState.errors.runtimeSeconds?.message}><input type="number" min="1" {...form.register("runtimeSeconds")} /></Field><Field label="Status" error={form.formState.errors.status?.message}><select {...form.register("status")}><option value="draft">Draft</option><option value="in_review">In review</option></select></Field></div><Field label="Review deadline" error={form.formState.errors.reviewDeadline?.message}><input type="datetime-local" {...form.register("reviewDeadline")} /></Field>{error && <p className="text-xs text-[#a35e41]">{error}</p>}<div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Registering…" : "Register review cut"}</Button></div></form></div></div>}</>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:px-3 [&_input]:text-sm [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-white [&_select]:px-2 [&_select]:text-sm">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>;
}
