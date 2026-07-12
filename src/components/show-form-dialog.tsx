"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { showFormSchema } from "@/lib/validations/entities";

type ShowFormValues = z.input<typeof showFormSchema>;
type TeamMember = { id: string; name: string; role: string; availability: string; isActive: boolean };

export function ShowFormDialog({ show, people = [], assignedTeamIds = [] }: { show?: { id: string; title: string; code: string; network: string | null; productionCompany: string | null; description?: string | null }; people?: TeamMember[]; assignedTeamIds?: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<ShowFormValues>({
    resolver: zodResolver(showFormSchema),
    defaultValues: { title: show?.title ?? "", code: show?.code ?? "", network: show?.network ?? "", productionCompany: show?.productionCompany ?? "", description: show?.description ?? "", teamMemberIds: assignedTeamIds },
  });
  const teamMemberIds = useWatch({ control: form.control, name: "teamMemberIds" }) ?? [];

  async function submit(values: ShowFormValues) {
    setError("");
    const response = await fetch(show ? `/api/shows/${show.id}` : "/api/shows", { method: show ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!response.ok) { setError((await response.json()).error ?? "Could not save show."); return; }
    setOpen(false); form.reset(values); router.refresh();
  }

  return <>
    <Button variant={show ? "tertiary" : "primary"} onClick={() => setOpen(true)} className={show ? "border border-[#e3e4df] bg-white text-[#4e5754]" : "bg-[#263130] text-white"}>{show ? <Pencil size={15} /> : <Plus size={16} />}{show ? "Edit show" : "New show"}</Button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4"><div className="w-full max-w-lg rounded-xl border border-[#e2e3de] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{show ? "Edit show" : "Create show"}</h2><p className="mt-1 text-sm text-[#767c78]">Set the production and client context for this workspace.</p></div><button onClick={() => setOpen(false)} className="rounded-md p-1 text-[#7d827e] hover:bg-[#f0f1ed]"><X size={18} /></button></div>
      <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(submit)}>
        <Field label="Show title" error={form.formState.errors.title?.message}><input {...form.register("title")} placeholder="Signal North" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Show code" error={form.formState.errors.code?.message}><input {...form.register("code")} placeholder="SN" className="uppercase" /></Field><Field label="Network / client" error={form.formState.errors.network?.message}><input {...form.register("network")} placeholder="Northstar Network" /></Field></div>
        <Field label="Production company" error={form.formState.errors.productionCompany?.message}><input {...form.register("productionCompany")} placeholder="Vantage Television" /></Field>
        <Field label="Notes" error={form.formState.errors.description?.message}><textarea {...form.register("description")} rows={3} placeholder="Optional production notes" /></Field>
        <fieldset><legend className="text-xs font-medium text-[#535b57]">Show team <span className="font-normal text-[#858a87]">(optional)</span></legend><p className="mt-1 text-[11px] leading-4 text-[#858a87]">Assign the core post team now. Episode assignments are made separately when you create an episode.</p>{people.length ? <div className="mt-2 grid max-h-44 gap-1.5 overflow-y-auto rounded-md border border-[#dedfda] p-2 sm:grid-cols-2">{people.filter((person) => person.isActive).map((person) => { const selected = teamMemberIds.includes(person.id); return <label key={person.id} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${selected ? "bg-[#edf3ef] text-[#34554a]" : "hover:bg-[#fafaf8] text-[#505854]"}`}><input type="checkbox" checked={selected} onChange={(event) => { form.setValue("teamMemberIds", event.target.checked ? [...teamMemberIds, person.id] : teamMemberIds.filter((id) => id !== person.id), { shouldDirty: true, shouldValidate: true }); }} /><span className="min-w-0"><span className="block truncate font-medium">{person.name}</span><span className="block capitalize text-[10px] text-[#858a87]">{person.role.replaceAll("_", " ")} · {person.availability.replaceAll("_", " ")}</span></span></label>; })}</div> : <p className="mt-2 rounded-md border border-dashed border-[#dedfda] px-3 py-2 text-xs text-[#858a87]">Add people in Team before assigning a show team.</p>}</fieldset>
        {error && <p className="text-xs text-[#a35e41]">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={() => setOpen(false)} className="text-[#59615e]">Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : show ? "Save changes" : "Create show"}</Button></div>
      </form>
    </div></div>}
  </>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input:focus]:border-[#66877f] [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:p-3 [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea:focus]:border-[#66877f]">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>;
}
