"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

export function WorkOrderTimeSettingsForm({ initialStandardDayHours, initialOvertimeMultiplier }: { initialStandardDayHours: string | number; initialOvertimeMultiplier: string | number }) {
  const router = useRouter();
  const [hours, setHours] = useState(String(initialStandardDayHours));
  const [overtimeMultiplier, setOvertimeMultiplier] = useState(String(initialOvertimeMultiplier));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true); setMessage("");
    const response = await postpilotUiFetch("/v1/settings/work-order-time", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standardDayHours: Number(hours), overtimeMultiplier: Number(overtimeMultiplier) }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setMessage(body?.error ?? "Could not save the work-order time settings.");
    setMessage("Saved. New work orders and confirmed bookings will snapshot these defaults."); router.refresh();
  }

  return <section className="panel max-w-xl p-5"><h2 className="text-sm font-semibold text-[#343b38]">Time and overtime</h2><p className="mt-1 text-xs leading-5 text-[#858a87]">These are the default commercial rules for new work orders and confirmed bookings. Existing records retain their historical rate and overtime snapshots.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium text-[#535b57]">Hours in a standard day<input type="number" min="1" max="24" step="0.5" inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></label><label className="block text-xs font-medium text-[#535b57]">Overtime multiplier<input type="number" min="1" max="10" step="0.05" inputMode="decimal" value={overtimeMultiplier} onChange={(event) => setOvertimeMultiplier(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /><span className="mt-1 block text-[11px] font-normal leading-4 text-[#858a87]">For example, 1.5 means time-and-a-half.</span></label></div><div className="mt-5 flex items-center gap-3"><Button variant="primary" isDisabled={saving || !hours || !overtimeMultiplier} onPress={save} className="bg-[#263130] text-white">{saving ? "Saving…" : "Save time rules"}</Button>{message && <p className={`text-xs ${message.startsWith("Saved") ? "text-[#557269]" : "text-[#a35e41]"}`}>{message}</p>}</div></section>;
}
