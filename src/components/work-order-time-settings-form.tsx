"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

export function WorkOrderTimeSettingsForm({ initialStandardDayHours }: { initialStandardDayHours: string | number }) {
  const router = useRouter();
  const [hours, setHours] = useState(String(initialStandardDayHours));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true); setMessage("");
    const response = await postpilotUiFetch("/v1/settings/work-order-time", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standardDayHours: Number(hours) }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setMessage(body?.error ?? "Could not save the work-order time settings.");
    setMessage("Saved. New work orders will snapshot this standard day."); router.refresh();
  }

  return <section className="panel max-w-xl p-5"><h2 className="text-sm font-semibold text-[#343b38]">Standard facility day</h2><p className="mt-1 text-xs leading-5 text-[#858a87]">Used for new work-order day, half-day, and week occupancy snapshots, and for deriving an agreed client overtime basis. Existing work orders keep their historical snapshot.</p><label className="mt-5 block text-xs font-medium text-[#535b57]">Hours in a standard day<input type="number" min="1" max="24" step="0.5" inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} className="mt-1.5 h-10 w-full max-w-sm rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></label><div className="mt-5 flex items-center gap-3"><Button variant="primary" isDisabled={saving || !hours} onPress={save} className="bg-[#263130] text-white">{saving ? "Saving…" : "Save standard day"}</Button>{message && <p className={`text-xs ${message.startsWith("Saved") ? "text-[#557269]" : "text-[#a35e41]"}`}>{message}</p>}</div></section>;
}
