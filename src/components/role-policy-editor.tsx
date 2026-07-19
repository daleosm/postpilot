"use client";

import { Button } from "@heroui/react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Policy = { role: string; label: string; permissions: string[] };

const permissionLabels: Record<string, string> = {
  manage_settings: "Settings & access",
  manage_production: "Production operations",
  do_assigned_work: "Assigned work",
  sign_off_work: "Sign off assigned work",
  manage_qc_delivery: "QC & delivery",
  manage_commercial: "Commercial",
  manage_catering: "Runner desk",
  view_all_operations: "View all operations",
};

export function RolePolicyEditor({ initialPolicies, permissions }: { initialPolicies: Policy[]; permissions: readonly string[] }) {
  const router = useRouter();
  const [policies, setPolicies] = useState(initialPolicies);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function update(role: string, patch: Partial<Policy>) {
    if (role === "client") return;
    setPolicies((items) => items.map((item) => item.role === role ? { ...item, ...patch } : item));
  }

  function toggle(role: string, permission: string) {
    const policy = policies.find((item) => item.role === role);
    if (!policy) return;
    update(role, { permissions: policy.permissions.includes(permission) ? policy.permissions.filter((item) => item !== permission) : [...policy.permissions, permission] });
  }

  function addRole() {
    const suffix = crypto.randomUUID().slice(0, 8).replaceAll("-", "");
    setPolicies((items) => [...items, { role: `new_role_${suffix}`, label: "New role", permissions: [] }]);
  }

  function removeRole(role: string) {
    if (role === "client") return;
    setPolicies((items) => items.filter((item) => item.role !== role));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings/role-policies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policies }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not save role settings.");
      setMessage("Role settings saved for this post house.");
      router.refresh();
    } catch {
      setMessage("Could not save role settings.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-4"><div className="flex justify-end"><Button variant="tertiary" onPress={addRole} className="border border-[#dfe3df] bg-white text-[#45685e]"><Plus size={15} /> Add role</Button></div>{policies.map((policy) => { const fixed = policy.role === "client"; return <section key={policy.role} className="panel p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="grid w-full max-w-xl gap-3 sm:grid-cols-2"><label className="block text-xs font-medium text-[#535b57]">Role label<input value={policy.label} disabled={fixed} onChange={(event) => update(policy.role, { label: event.target.value })} className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] px-3 text-sm disabled:bg-[#f1f2ef]" /></label><label className="block text-xs font-medium text-[#535b57]">Role key<input value={policy.role} disabled={!policy.role.startsWith("new_role_")} onChange={(event) => { const next = event.target.value; if (!next || policies.some((item) => item.role === next)) return; setPolicies((items) => items.map((item) => item.role === policy.role ? { ...item, role: next } : item)); }} className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] px-3 text-sm disabled:bg-[#f1f2ef]" /></label></div>{fixed ? <span className="rounded-full bg-[#eef3ee] px-2.5 py-1 text-[10px] font-semibold text-[#587063]">System role</span> : <Button isIconOnly variant="tertiary" onPress={() => removeRole(policy.role)} aria-label={`Remove ${policy.label}`} className="min-w-0 text-[#8b918e] hover:bg-[#f3e9e4] hover:text-[#a35e41]"><Trash2 size={15} /></Button>}</div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{permissions.map((permission) => <label key={permission} className="flex min-h-9 items-center gap-2 rounded-md border border-[#ecebe7] px-3 text-xs text-[#525b57]"><input type="checkbox" disabled={fixed} checked={policy.permissions.includes(permission)} onChange={() => toggle(policy.role, permission)} /><span>{permissionLabels[permission] ?? permission}</span></label>)}</div></section>; })}<div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className={`text-xs ${message.includes("saved") ? "text-[#4d8068]" : "text-[#a35e41]"}`}>{message}</p><Button variant="primary" onClick={save} isDisabled={saving} className="bg-[#263130] text-white"><Save size={15} /> {saving ? "Saving…" : "Save roles & permissions"}</Button></div></div>;
}
