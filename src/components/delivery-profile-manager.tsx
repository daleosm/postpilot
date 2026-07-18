"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { ClipboardList, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export type DeliveryProfileRecord = {
  id: string;
  name: string;
  clientCompanyId: string | null;
  network: string | null;
  showId: string | null;
  specificationUrl: string | null;
  isActive: boolean;
  items: DeliveryProfileItemRecord[];
};

type DeliveryProfileItemRecord = {
  id: string;
  componentType: string;
  label: string;
  required: boolean;
  formatSpecification: string | null;
  version: string | null;
  territory: string | null;
  language: string | null;
  recipientContactId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  requiresExternalRecipient: boolean;
  qcRequired: boolean;
  defaultDeadlineOffsetDays: number | null;
  position: number;
};

type Choice = { id: string; name: string };
type Contact = Choice & { email: string | null };

const profileSchema = z.object({
  name: z.string().trim().min(2, "Profile name is required.").max(160),
  clientCompanyId: z.string(),
  network: z.string().trim().max(120),
  showId: z.string(),
  specificationUrl: z.string().trim().url("Enter a valid specification link.").or(z.literal("")),
  isActive: z.boolean(),
});
type ProfileInput = z.input<typeof profileSchema>;
type ProfileValues = z.output<typeof profileSchema>;

const itemSchema = z.object({
  componentType: z.string().trim().min(2, "Component type is required.").max(80),
  label: z.string().trim().min(2, "Delivery item label is required.").max(240),
  required: z.boolean(),
  formatSpecification: z.string().trim().max(4000),
  version: z.string().trim().max(120),
  territory: z.string().trim().max(120),
  language: z.string().trim().max(120),
  recipientContactId: z.string(),
  requiresExternalRecipient: z.boolean(),
  qcRequired: z.boolean(),
  defaultDeadlineOffsetDays: z.coerce.number().int().min(-365).max(3650).nullable(),
  position: z.coerce.number().int().positive(),
});
type ItemInput = z.input<typeof itemSchema>;
type ItemValues = z.output<typeof itemSchema>;

const componentTypes = ["master", "textless_master", "me_mix", "audio_stems", "captions", "subtitles", "qc_report", "thumbnail", "metadata_sheet", "promo", "other"];

export function DeliveryProfileManager({ profiles, companies, shows, recipients }: { profiles: DeliveryProfileRecord[]; companies: Choice[]; shows: Choice[]; recipients: Contact[] }) {
  return <section className="panel overflow-hidden">
    <div className="flex flex-col justify-between gap-3 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-center">
      <div><h2 className="text-sm font-semibold text-[#343b38]">Delivery profiles</h2><p className="mt-1 text-xs text-[#858a87]">Reusable specification checklists. Applying one copies a fixed snapshot to an episode.</p></div>
      <ProfileDialog companies={companies} shows={shows} />
    </div>
    <div className="divide-y divide-[#efeeea]">
      {profiles.map((profile) => <ProfileRow key={profile.id} profile={profile} companies={companies} shows={shows} recipients={recipients} />)}
      {!profiles.length && <div className="px-5 py-12 text-center"><ClipboardList className="mx-auto text-[#a1a7a3]" size={22} /><p className="mt-3 text-sm font-medium text-[#59615d]">No delivery profiles yet</p><p className="mt-1 text-xs text-[#858a87]">Create a network, streamer, or show-specific checklist before applying it to an episode.</p></div>}
    </div>
  </section>;
}

function ProfileRow({ profile, companies, shows, recipients }: { profile: DeliveryProfileRecord; companies: Choice[]; shows: Choice[]; recipients: Contact[] }) {
  const scope = [profile.showId ? shows.find((show) => show.id === profile.showId)?.name : null, profile.clientCompanyId ? companies.find((company) => company.id === profile.clientCompanyId)?.name : null, profile.network].filter(Boolean).join(" · ");
  return <div className="px-5 py-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[#404844]">{profile.name}</p><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${profile.isActive ? "bg-[#e7eee8] text-[#4d7063]" : "bg-[#eff1ef] text-[#6f7873]"}`}>{profile.isActive ? "Active" : "Inactive"}</span></div><p className="mt-1.5 text-xs text-[#7d837f]">{scope || "Post-house default"} · {profile.items.length} requirement{profile.items.length === 1 ? "" : "s"}</p>{profile.specificationUrl && <a className="mt-1.5 block max-w-md truncate text-xs font-medium text-[#47756a] hover:underline" href={profile.specificationUrl} target="_blank" rel="noreferrer">{profile.specificationUrl}</a>}</div><div className="flex shrink-0 gap-2"><RequirementDialog profile={profile} recipients={recipients} /><ProfileDialog profile={profile} companies={companies} shows={shows} /></div></div>
    <div className="mt-4 overflow-hidden rounded-lg border border-[#e6e8e4]"><div className="hidden grid-cols-[minmax(0,1fr)_100px_130px_120px_auto] gap-3 border-b border-[#ebece8] bg-[#fafbf9] px-4 py-2 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7a827d] md:grid"><span>Requirement</span><span>Required</span><span>QC</span><span>Deadline</span><span /></div>{profile.items.map((item) => <RequirementRow key={item.id} item={item} profile={profile} recipients={recipients} />)}{!profile.items.length && <p className="px-4 py-5 text-sm text-[#7c847f]">No requirements yet. Add masters, audio, captions, metadata, or another delivery component.</p>}</div>
  </div>;
}

function RequirementRow({ item, profile, recipients }: { item: DeliveryProfileItemRecord; profile: DeliveryProfileRecord; recipients: Contact[] }) {
  const detail = [item.formatSpecification, item.version, item.territory, item.language].filter(Boolean).join(" · ");
  return <div className="grid gap-2 border-t border-[#eef0ec] px-4 py-3 md:grid-cols-[minmax(0,1fr)_100px_130px_120px_auto] md:items-center"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#46504b]">{item.label}</p><p className="mt-0.5 truncate text-[11px] text-[#7c847f]">{detail || item.componentType}{item.recipientName ? ` · ${item.recipientName}` : ""}</p></div><span className="text-xs text-[#65716b]">{item.required ? "Required" : "Optional"}</span><span className="text-xs text-[#65716b]">{item.qcRequired ? "QC required" : "No QC"}</span><span className="text-xs text-[#65716b]">{item.defaultDeadlineOffsetDays === null ? "Episode date" : `${item.defaultDeadlineOffsetDays} days`}</span><RequirementDialog profile={profile} item={item} recipients={recipients} /></div>;
}

function ProfileDialog({ profile, companies, shows }: { profile?: DeliveryProfileRecord; companies: Choice[]; shows: Choice[] }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const form = useForm<ProfileInput, unknown, ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: profileDefaults(profile) });
  function close() { setOpen(false); setError(""); form.reset(profileDefaults(profile)); }
  async function submit(values: ProfileValues) {
    setError(""); const payload = { ...values, clientCompanyId: values.clientCompanyId || null, network: values.network || null, showId: values.showId || null, specificationUrl: values.specificationUrl || null };
    const response = await fetch(profile ? `/api/delivery-profiles/${profile.id}` : "/api/delivery-profiles", { method: profile ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null); if (!response.ok) return setError(body?.error ?? "Could not save the delivery profile."); close(); router.refresh();
  }
  return <><Button variant={profile ? "tertiary" : "primary"} onPress={() => setOpen(true)} className={profile ? "min-w-0 border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>{profile ? <><Pencil size={14} /> Edit profile</> : <><Plus size={16} /> New delivery profile</>}</Button>{open && <Modal title={profile ? "Edit delivery profile" : "New delivery profile"} description="Profiles define future episode checklists. Existing episode manifests are never changed." close={close}><form className="space-y-4" onSubmit={form.handleSubmit(submit)}><Field label="Profile name" error={form.formState.errors.name?.message}><input {...form.register("name")} placeholder="Network drama delivery v1" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Client / network account"><select {...form.register("clientCompanyId")}><option value="">Any account</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field><Field label="Show (optional)"><select {...form.register("showId")}><option value="">Any show</option>{shows.map((show) => <option key={show.id} value={show.id}>{show.name}</option>)}</select></Field></div><Field label="Network name (optional)" error={form.formState.errors.network?.message}><input {...form.register("network")} placeholder="Broadcaster or streamer name" /></Field><Field label="Specification link (optional)" error={form.formState.errors.specificationUrl?.message}><input {...form.register("specificationUrl")} placeholder="https://…" /></Field><label className="flex items-center gap-2 text-xs font-medium text-[#535b57]"><input type="checkbox" {...form.register("isActive")} /> Available to apply to episodes</label>{error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}<ModalActions close={close} submitting={form.formState.isSubmitting} label={profile ? "Save profile" : "Create profile"} /></form></Modal>}</>;
}

function RequirementDialog({ profile, item, recipients }: { profile: DeliveryProfileRecord; item?: DeliveryProfileItemRecord; recipients: Contact[] }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const form = useForm<ItemInput, unknown, ItemValues>({ resolver: zodResolver(itemSchema), defaultValues: itemDefaults(item, profile.items.length + 1) });
  function close() { setOpen(false); setError(""); form.reset(itemDefaults(item, profile.items.length + 1)); }
  async function submit(values: ItemValues) {
    setError(""); const payload = { ...values, formatSpecification: values.formatSpecification || null, version: values.version || null, territory: values.territory || null, language: values.language || null, recipientContactId: values.recipientContactId || null, defaultDeadlineOffsetDays: values.defaultDeadlineOffsetDays ?? null };
    const url = item ? `/api/delivery-profiles/${profile.id}/items/${item.id}` : `/api/delivery-profiles/${profile.id}/items`;
    const response = await fetch(url, { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null); if (!response.ok) return setError(body?.error ?? "Could not save the delivery requirement."); close(); router.refresh();
  }
  return <><Button size="sm" variant="tertiary" onPress={() => setOpen(true)} className="min-w-0 border border-[#dfe3df] bg-white text-[#58635e]">{item ? <><Pencil size={13} /> Edit</> : <><Plus size={14} /> Add requirement</>}</Button>{open && <Modal title={item ? "Edit delivery requirement" : "Add delivery requirement"} description="This affects episodes that use this profile in the future." close={close}><form className="space-y-4" onSubmit={form.handleSubmit(submit)}><div className="grid gap-3 sm:grid-cols-2"><Field label="Component type" error={form.formState.errors.componentType?.message}><select {...form.register("componentType")}>{componentTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></Field><Field label="Display label" error={form.formState.errors.label?.message}><input {...form.register("label")} placeholder="ProRes UHD master" /></Field></div><Field label="Format / specification" error={form.formState.errors.formatSpecification?.message}><input {...form.register("formatSpecification")} placeholder="ProRes 422 HQ, 3840×2160, 25fps" /></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="Version"><input {...form.register("version")} placeholder="TX v1" /></Field><Field label="Territory"><input {...form.register("territory")} placeholder="UK" /></Field><Field label="Language"><input {...form.register("language")} placeholder="English" /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Default deadline offset (days)" error={form.formState.errors.defaultDeadlineOffsetDays?.message}><input type="number" {...form.register("defaultDeadlineOffsetDays")} placeholder="0" /></Field><Field label="Recipient (network/studio)"><select {...form.register("recipientContactId")}><option value="">Select when dispatching</option>{recipients.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : ""}</option>)}</select></Field></div><div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#535b57]"><label className="flex items-center gap-2"><input type="checkbox" {...form.register("required")} /> Required</label><label className="flex items-center gap-2"><input type="checkbox" {...form.register("qcRequired")} /> QC required</label><label className="flex items-center gap-2"><input type="checkbox" {...form.register("requiresExternalRecipient")} /> External recipient required</label></div><Field label="Position" error={form.formState.errors.position?.message}><input type="number" min="1" {...form.register("position")} /></Field>{error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}<ModalActions close={close} submitting={form.formState.isSubmitting} label={item ? "Save requirement" : "Add requirement"} /></form></Modal>}</>;
}

function Modal({ title, description, close, children }: { title: string; description: string; close: () => void; children: ReactNode }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{title}</h2><p className="mt-1 text-sm text-[#767c78]">{description}</p></div><Button isIconOnly variant="tertiary" onPress={close} aria-label="Close" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div><div className="mt-6">{children}</div></div></div>; }
function ModalActions({ close, submitting, label }: { close: () => void; submitting: boolean; label: string }) { return <div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={close}>Cancel</Button><Button type="submit" variant="primary" isDisabled={submitting} className="bg-[#263130] text-white">{submitting ? "Saving…" : label}</Button></div>; }
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-white [&_select]:px-2 [&_select]:text-sm">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>; }
function profileDefaults(profile?: DeliveryProfileRecord): ProfileInput { return { name: profile?.name ?? "", clientCompanyId: profile?.clientCompanyId ?? "", network: profile?.network ?? "", showId: profile?.showId ?? "", specificationUrl: profile?.specificationUrl ?? "", isActive: profile?.isActive ?? true }; }
function itemDefaults(item: DeliveryProfileItemRecord | undefined, position: number): ItemInput { return { componentType: item?.componentType ?? "master", label: item?.label ?? "", required: item?.required ?? true, formatSpecification: item?.formatSpecification ?? "", version: item?.version ?? "", territory: item?.territory ?? "", language: item?.language ?? "", recipientContactId: item?.recipientContactId ?? "", requiresExternalRecipient: item?.requiresExternalRecipient ?? false, qcRequired: item?.qcRequired ?? false, defaultDeadlineOffsetDays: item?.defaultDeadlineOffsetDays ?? null, position: item?.position ?? position }; }
