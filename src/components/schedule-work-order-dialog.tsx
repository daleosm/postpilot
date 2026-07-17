"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type SchedulableWorkOrder = { id: string; title: string; showTitle: string; episodeTitle: string; episodeNumber: number; workflowStageName: string | null; dueAt: Date | null };

export function ScheduleWorkOrderDialog({ workOrder, rooms, initialRoomId, initialStart, onClose }: { workOrder: SchedulableWorkOrder | null; rooms: Array<{ id: string; name: string; type: string }>; initialRoomId: string | null; initialStart: Date | null; onClose: () => void }) {
  const router = useRouter();
  const [roomId, setRoomId] = useState(initialRoomId ?? "");
  const [start, setStart] = useState(initialStart ? input(initialStart) : "");
  const [end, setEnd] = useState(initialStart ? input(addHours(initialStart, 2)) : "");
  const [notes, setNotes] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  if (!workOrder) return null;
  const submit = async () => {
    setSaving(true); setMessage("");
    const response = await fetch(`/api/work-orders/${workOrder.id}/booking`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), notes: notes || null }) });
    const body = await response.json(); setSaving(false);
    if (!response.ok) return setMessage(body.error ?? "Could not reserve this room.");
    onClose(); router.refresh();
  };
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#202725]/30 p-4"><div className="w-full max-w-lg rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#78837e]">Reserve work order</p><h2 className="mt-1 text-lg font-semibold text-[#2d3431]">{workOrder.title}</h2><p className="mt-1 text-sm text-[#757d78]">{workOrder.showTitle} · E{String(workOrder.episodeNumber).padStart(2, "0")} {workOrder.episodeTitle}</p></div><Button isIconOnly variant="tertiary" onPress={onClose} aria-label="Close">×</Button></div><p className="mt-4 rounded-lg border border-[#e4e8e3] bg-[#f3f7f3] px-3 py-2 text-xs text-[#51665d]">This creates a confirmed room booking, so the slot cannot be taken by another team. Confirm your actual time afterwards to update the episode cost.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#4c5651]">Suite / room<select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-3 text-sm"><option value="">Choose a room</option>{rooms.filter((room) => ["edit_bay", "color_suite", "mix_room", "qc_room"].includes(room.type)).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label className="text-xs font-medium text-[#4c5651]">Start<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-3 text-sm" /></label><label className="text-xs font-medium text-[#4c5651]">End<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-3 text-sm" /></label><label className="text-xs font-medium text-[#4c5651]">Booking note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Optional handover or room note" className="mt-1.5 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] p-3 text-sm" /></label></div>{message && <p role="alert" className="mt-3 text-xs text-[#a35e41]">{message}</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="tertiary" isDisabled={saving} onPress={onClose}>Cancel</Button><Button variant="primary" isDisabled={saving || !roomId || !start || !end} onPress={submit} className="bg-[#2d6d56] text-white">{saving ? "Reserving…" : "Reserve room"}</Button></div></div></div>;
}

function input(date: Date) { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function addHours(date: Date, hours: number) { return new Date(date.getTime() + hours * 3_600_000); }
