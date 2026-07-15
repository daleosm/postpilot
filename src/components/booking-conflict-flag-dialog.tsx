"use client";

import { Button } from "@heroui/react";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

export function BookingConflictFlagDialog({ bookingId, title }: { bookingId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true); setMessage("");
    const response = await fetch(`/api/bookings/${bookingId}/flag-conflict`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setMessage(body?.error ?? "Could not flag this booking.");
    setOpen(false); setReason("");
  }

  return <><Button size="sm" variant="tertiary" onPress={() => setOpen(true)} className="border border-[#ead7ce] bg-[#fffaf7] text-[#9a5b42]"><AlertTriangle size={14} /> Flag conflict</Button>{open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#202725]/25 p-4" role="dialog" aria-modal="true" aria-label="Flag booking conflict"><div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#2d3431]">Flag booking conflict</h2><p className="mt-1 text-sm text-[#767c78]">Tell production what needs attention for {title}.</p></div><Button isIconOnly variant="tertiary" onPress={() => setOpen(false)} aria-label="Close conflict form"><X size={17} /></Button></div><label className="mt-5 block text-xs font-medium text-[#535b57]">What is the conflict?<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="For example: client review overran the preceding mix." className="mt-1.5 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] p-3 text-sm" /></label>{message && <p role="alert" className="mt-3 text-xs text-[#a35e41]">{message}</p>}<div className="mt-4 flex justify-end gap-2"><Button variant="tertiary" isDisabled={saving} onPress={() => setOpen(false)}>Cancel</Button><Button variant="primary" isDisabled={saving || reason.trim().length < 3} onPress={submit} className="bg-[#9a5b42] text-white">{saving ? "Sending…" : "Flag conflict"}</Button></div></div></div>}</>;
}
