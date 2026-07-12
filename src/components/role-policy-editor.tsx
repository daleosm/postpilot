"use client";

import { Button } from "@heroui/react";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Policy = { role: string; label: string; permissions: string[] };

const permissionLabels: Record<string, string> = {
  manage_shows: "Shows & episodes",
  manage_bookings: "Bookings",
  manage_reviews: "Review administration",
  approve_reviews: "Approve workflow gates",
  update_notes: "Notes",
  update_tasks: "Tasks",
  manage_deliverables: "Deliverables",
  manage_budget: "Budget",
  request_catering: "Request catering",
  manage_catering: "Runner desk",
  view_assigned: "Assigned work",
};

export function RolePolicyEditor({ initialPolicies, permissions }: { initialPolicies: Policy[]; permissions: readonly string[] }) {
  const router = useRouter();
  const [policies, setPolicies] = useState(initialPolicies);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function update(role: string, patch: Partial<Policy>) {
    setPolicies((items) => items.map((item) => item.role === role ? { ...item, ...patch } : item));
  }

  function toggle(role: string, permission: string) {
    const policy = policies.find((item) => item.role === role);
    if (!policy) return;
    update(role, { permissions: policy.permissions.includes(permission) ? policy.permissions.filter((item) => item !== permission) : [...policy.permissions, permission] });
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

  return <div className="space-y-4">{policies.map((policy) => <section key={policy.role} className="panel p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><label className="block max-w-sm text-xs font-medium text-[#535b57]">Role label<input value={policy.label} onChange={(event) => update(policy.role, { label: event.target.value })} className="mt-1.5 h-9 w-full rounded-md border border-[#dedfda] px-3 text-sm" /></label><p className="rounded bg-[#f1f2ef] px-2 py-1 text-[10px] font-semibold uppercase tracking-[.08em] text-[#6d7671]">{policy.role.replaceAll("_", " ")}</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{permissions.map((permission) => <label key={permission} className="flex min-h-9 items-center gap-2 rounded-md border border-[#ecebe7] px-3 text-xs text-[#525b57]"><input type="checkbox" checked={policy.permissions.includes(permission)} onChange={() => toggle(policy.role, permission)} /><span>{permissionLabels[permission] ?? permission}</span></label>)}</div></section>)}<div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className={`text-xs ${message.includes("saved") ? "text-[#4d8068]" : "text-[#a35e41]"}`}>{message}</p><Button variant="primary" onClick={save} isDisabled={saving} className="bg-[#263130] text-white"><Save size={15} /> {saving ? "Saving…" : "Save roles & permissions"}</Button></div></div>;
}
