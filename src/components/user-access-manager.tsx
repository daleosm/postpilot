"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Pencil, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

type Policy = { role: string; label: string };
type UserAccess = { userId: string; userName: string | null; email: string; membershipRole: "owner" | "admin" | "member" | "client"; personId: string | null; personName: string | null; personRole: string | null; isActive: boolean | null };

const newUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the user's name.").max(120),
  email: z.string().email("Enter a valid work email.").max(320),
  personRole: z.string().min(1, "Select a post-house role."),
  membershipRole: z.enum(["admin", "member", "client"]),
});
type NewUser = z.infer<typeof newUserSchema>;

export function UserAccessManager({ users, policies }: { users: UserAccess[]; policies: Policy[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccess | null>(null);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const guestRole = "client";
  const firstOperationalRole = policies.find((policy) => policy.role !== guestRole)?.role ?? guestRole;
  const form = useForm<NewUser>({ resolver: zodResolver(newUserSchema), defaultValues: { name: "", email: "", personRole: firstOperationalRole, membershipRole: "member" } });
  const newMembershipRole = useWatch({ control: form.control, name: "membershipRole" });
  const roleName = (role: string | null) => policies.find((policy) => policy.role === role)?.label ?? role?.replaceAll("_", " ") ?? "Not assigned";

  async function create(values: NewUser) {
    setMessage("");
    const response = await fetch("/api/settings/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return setMessage(body?.error ?? "Could not add this user.");
    form.reset({ name: "", email: "", personRole: firstOperationalRole, membershipRole: "member" });
    setOpen(false);
    setMessage("User access created. They can now request an email one-time code to sign in.");
    router.refresh();
  }

  async function saveAccess() {
    if (!editing?.personRole) return;
    setMessage("");
    const response = await fetch(`/api/settings/users/${editing.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personRole: editing.personRole, membershipRole: editing.membershipRole }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return setMessage(body?.error ?? "Could not update access.");
    setEditing(null);
    setMessage("User access updated.");
    router.refresh();
  }

  async function removeAccess(user: UserAccess) {
    if (!window.confirm(`Remove ${user.personName ?? user.userName ?? user.email} from this post house? Their global account and other post-house memberships are kept.`)) return;
    setRemoving(user.userId);
    setMessage("");
    const response = await fetch(`/api/settings/users/${user.userId}`, { method: "DELETE" });
    const body = await response.json().catch(() => null);
    setRemoving(null);
    if (!response.ok) return setMessage(body?.error ?? "Could not remove access.");
    setMessage("Access removed from this post house.");
    router.refresh();
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-[#7d837f]">{users.length} active account{users.length === 1 ? "" : "s"} in this post house.</p>
      <Button variant="primary" onPress={() => { setMessage(""); setOpen(true); }} className="bg-[#263130] text-white"><UserPlus size={16} /> Add user</Button>
    </div>

    <section className="panel overflow-hidden">
      <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_110px_120px] gap-3 border-b border-[#ebeae6] bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e837f] md:grid"><span>User</span><span>Post-house role</span><span>Access</span><span /></div>
      <div className="divide-y divide-[#efeeea]">{users.map((user) => <article key={user.userId} className="flex flex-col gap-3 px-4 py-4 md:grid md:grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_110px_120px] md:items-center md:gap-3 md:px-5">
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#46514c]">{user.personName ?? user.userName ?? user.email}</p><p className="mt-0.5 truncate text-xs text-[#858a87]">{user.email}</p></div>
        <p className="capitalize text-xs text-[#59625e]">{roleName(user.personRole)}</p>
        <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-semibold ${user.membershipRole === "admin" || user.membershipRole === "owner" ? "bg-[#e9f2eb] text-[#4d8068]" : user.membershipRole === "client" ? "bg-[#f4f0e8] text-[#8b7041]" : "bg-[#eef1ee] text-[#64706b]"}`}>{user.membershipRole}</span>
        <div className="flex items-center gap-1.5 md:justify-end">{user.membershipRole === "owner" ? <span className="text-[10px] font-medium text-[#858a87]">Owner</span> : <><Button size="sm" variant="tertiary" onPress={() => setEditing({ ...user, personRole: user.personRole ?? firstOperationalRole })} className="border border-[#dfe3df] bg-white text-[#52635d]"><Pencil size={13} /> Edit</Button><Button isIconOnly size="sm" variant="tertiary" isDisabled={removing === user.userId} onPress={() => removeAccess(user)} aria-label={`Remove ${user.personName ?? user.email}`} className="min-w-0 text-[#8a918d] hover:bg-[#f7e9e4] hover:text-[#a35e41]"><Trash2 size={14} /></Button></>}</div>
      </article>)}{!users.length && <div className="px-5 py-12 text-center"><ShieldCheck className="mx-auto text-[#a0a6a1]" size={23} /><p className="mt-3 text-sm font-medium text-[#59615d]">No user accounts yet</p><p className="mt-1 text-xs text-[#858a87]">Add the first post-house user to give them email-code access.</p></div>}</div>
    </section>
    {message && <p role="status" className={`text-xs ${message.includes("Could not") || message.includes("cannot") ? "text-[#a35e41]" : "text-[#4d8068]"}`}>{message}</p>}

    {open && <UserDialog title="Add user" onClose={() => setOpen(false)}><form className="space-y-4" onSubmit={form.handleSubmit(create)}><p className="text-sm text-[#747977]">Creates access in this post house only. The person signs in with an email one-time code.</p><Field label="Name" error={form.formState.errors.name?.message}><input {...form.register("name")} autoFocus /></Field><Field label="Work email" error={form.formState.errors.email?.message}><input type="email" {...form.register("email")} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Post-house role" error={form.formState.errors.personRole?.message}>{newMembershipRole === "client" ? <input value="Client" disabled /> : <select {...form.register("personRole")}>{policies.filter((policy) => policy.role !== guestRole).map((policy) => <option key={policy.role} value={policy.role}>{policy.label}</option>)}</select>}</Field><Field label="Account access"><select {...form.register("membershipRole", { onChange: (event) => { const membershipRole = event.target.value; form.setValue("personRole", membershipRole === "client" ? guestRole : form.getValues("personRole") === guestRole ? firstOperationalRole : form.getValues("personRole")); } })}><option value="member">Member</option><option value="admin">Administrator</option><option value="client">Client</option></select></Field></div>{newMembershipRole === "client" && <p className="-mt-1 text-xs leading-5 text-[#747e79]">Client is a fixed role. Clients only see episodes shared with them and can sign off gates configured for Client.</p>}<DialogActions onClose={() => setOpen(false)} saving={form.formState.isSubmitting} label="Create user" /></form></UserDialog>}

    {editing && <UserDialog title={`Edit ${editing.personName ?? editing.userName ?? editing.email}`} onClose={() => setEditing(null)}><div className="space-y-4"><p className="text-sm text-[#747977]">{editing.email}</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Post-house role">{editing.membershipRole === "client" ? <input value="Client" disabled /> : <select value={editing.personRole ?? ""} onChange={(event) => setEditing({ ...editing, personRole: event.target.value })}>{policies.filter((policy) => policy.role !== guestRole).map((policy) => <option key={policy.role} value={policy.role}>{policy.label}</option>)}</select>}</Field><Field label="Account access"><select value={editing.membershipRole} onChange={(event) => { const membershipRole = event.target.value as UserAccess["membershipRole"]; setEditing({ ...editing, membershipRole, personRole: membershipRole === "client" ? guestRole : editing.personRole === guestRole ? firstOperationalRole : editing.personRole }); }}><option value="member">Member</option><option value="admin">Administrator</option><option value="client">Client</option></select></Field></div>{editing.membershipRole === "client" && <p className="-mt-1 text-xs leading-5 text-[#747e79]">Client is a fixed role. Assign the client to an episode and choose them as its workflow signer when a Client gate needs their sign-off.</p>}<div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button variant="tertiary" onPress={() => setEditing(null)}>Cancel</Button><Button variant="primary" onPress={saveAccess} className="bg-[#263130] text-white">Save access</Button></div></div></UserDialog>}
  </div>;
}

function UserDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}><div className="w-full max-w-lg rounded-t-2xl bg-[#fafbf9] p-5 shadow-xl sm:rounded-xl sm:p-6"><div className="flex items-start justify-between gap-4"><h2 className="text-lg font-semibold text-[#29322f]">{title}</h2><Button isIconOnly variant="tertiary" onPress={onClose} aria-label="Close"><X size={18} /></Button></div><div className="mt-5">{children}</div></div></div>; }
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<div className="mt-1.5">{children}</div>{error && <p className="mt-1 text-xs text-[#a35e41]">{error}</p>}</label>; }
function DialogActions({ onClose, saving, label }: { onClose: () => void; saving: boolean; label: string }) { return <div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" isDisabled={saving} onPress={onClose}>Cancel</Button><Button type="submit" variant="primary" isDisabled={saving} className="bg-[#263130] text-white">{saving ? "Creating…" : label}</Button></div>; }
