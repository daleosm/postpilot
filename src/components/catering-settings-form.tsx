"use client";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CateringSettingsForm({ initialMarkup }: { initialMarkup: string | number }) {
  const router = useRouter(); const [markup, setMarkup] = useState(String(initialMarkup)); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  async function save() { setSaving(true); setMessage(""); const response = await fetch("/api/settings/catering", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markupPercent: Number(markup) }) }); const body = await response.json().catch(() => null); setSaving(false); if (!response.ok) return setMessage(body?.error ?? "Could not save catering settings."); setMessage("Saved. New receipt costs will use this markup."); router.refresh(); }
  return <section className="panel max-w-xl p-5"><h2 className="text-sm font-semibold text-[#343b38]">Episode catering markup</h2><p className="mt-1 text-xs text-[#858a87]">Applied to the client bill when a runner records a receipt. Episode budget actuals remain the unmarked-up cost.</p><label className="mt-5 block text-xs font-medium text-[#535b57]">Markup percentage<div className="mt-1.5 flex max-w-xs items-center gap-2"><input type="number" min="0" max="100" step="0.01" value={markup} onChange={(event) => setMarkup(event.target.value)} className="h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /><span className="text-sm text-[#68716d]">%</span></div></label><div className="mt-5 flex items-center gap-3"><Button variant="primary" isDisabled={saving} onPress={save} className="bg-[#263130] text-white">{saving ? "Saving…" : "Save markup"}</Button>{message && <p className="text-xs text-[#557269]">{message}</p>}</div></section>;
}
