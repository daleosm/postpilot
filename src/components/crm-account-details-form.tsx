"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const accountFormSchema = z.object({
  accountStatus: z.enum(["active", "on_hold", "inactive"]),
  bookingClearance: z.enum(["clear", "po_required", "finance_approval", "on_hold"]),
  accountOwnerId: z.string().uuid().or(z.literal("")),
  nextAction: z.string().trim().max(500),
  nextActionDueAt: z.string().date().or(z.literal("")),
  notes: z.string().trim().max(8000),
});

type Values = z.infer<typeof accountFormSchema>;
type Account = { id: string; accountStatus: "active" | "on_hold" | "inactive"; bookingClearance: "clear" | "po_required" | "finance_approval" | "on_hold"; accountOwnerId: string | null; nextAction: string | null; nextActionDueAt: string | null; notes: string | null };

export function CrmAccountDetailsForm({ account, owners }: { account: Account; owners: Array<{ id: string; name: string; role: string }> }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(accountFormSchema), defaultValues: defaults(account) });
  function close() { setOpen(false); setError(""); form.reset(defaults(account)); }
  async function save(values: Values) {
    setError("");
    const response = await fetch(`/api/crm/companies/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, accountOwnerId: values.accountOwnerId || null, nextAction: values.nextAction || null, nextActionDueAt: values.nextActionDueAt || null, notes: values.notes || null }) });
    const body = await response.json().catch(() => null); if (!response.ok) return setError(body?.error ?? "Could not update this account."); close(); router.refresh();
  }
  return <><Button variant="secondary" onPress={() => setOpen(true)} className="border border-[#dfe3df] bg-white text-[#58635e]"><Pencil size={14} /> Update account</Button>{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4"><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">Account management</h2><p className="mt-1 text-sm text-[#767c78]">Internal relationship ownership, booking clearance, follow-up, and notes.</p></div><Button isIconOnly variant="tertiary" onPress={close} aria-label="Close" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div><form className="mt-6 space-y-4" onSubmit={form.handleSubmit(save)}><div className="grid gap-3 sm:grid-cols-2"><Field label="Account status" error={form.formState.errors.accountStatus?.message}><select {...form.register("accountStatus")}><option value="active">Active</option><option value="on_hold">On hold</option><option value="inactive">Inactive</option></select></Field><Field label="Booking clearance" error={form.formState.errors.bookingClearance?.message}><select {...form.register("bookingClearance")}><option value="clear">Clear to book</option><option value="po_required">Authorisation required</option><option value="finance_approval">Finance approval required</option><option value="on_hold">On hold</option></select></Field></div><Field label="Account owner" error={form.formState.errors.accountOwnerId?.message}><select {...form.register("accountOwnerId")}><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.role.replaceAll("_", " ")}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]"><Field label="Next action" error={form.formState.errors.nextAction?.message}><input {...form.register("nextAction")} placeholder="Confirm delivery contact…" /></Field><Field label="Due date" error={form.formState.errors.nextActionDueAt?.message}><input type="date" {...form.register("nextActionDueAt")} /></Field></div><Field label="Internal account notes" error={form.formState.errors.notes?.message}><textarea rows={7} {...form.register("notes")} placeholder="Commercial context, preferences, or follow-up notes. Never shown to clients." /></Field>{error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}<div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={close}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : "Save account"}</Button></div></form></div></div>}</>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-white [&_select]:px-2 [&_select]:text-sm [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:bg-white [&_textarea]:p-3 [&_textarea]:text-sm">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>; }
function defaults(account: Account): Values { return { accountStatus: account.accountStatus, bookingClearance: account.bookingClearance, accountOwnerId: account.accountOwnerId ?? "", nextAction: account.nextAction ?? "", nextActionDueAt: account.nextActionDueAt ?? "", notes: account.notes ?? "" }; }
