"use client";

import { Button } from "@heroui/react";
import { Coffee, Sandwich } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Resources = { rooms: Array<{ id: string; name: string; type: string }>; bookings: Array<{ id: string; roomName: string }> };

export function CateringRequestForm({ resources }: { resources: Resources }) {
  const router = useRouter();
  const [bookingId, setBookingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [requestType, setRequestType] = useState("lunch");
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [requestedFor, setRequestedFor] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!item.trim() || (!bookingId && !roomId)) return setMessage("Choose a booking or room and describe the request.");
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/catering-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: bookingId || null, roomId: roomId || null, requestType, item, quantity, requestedFor: requestedFor ? new Date(requestedFor).toISOString() : null, notes: notes || null }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not send your request.");
      setItem(""); setQuantity(1); setRequestedFor(""); setNotes(""); setMessage("Request sent to the runner desk."); router.refresh();
    } catch { setMessage("Could not send your request."); } finally { setSaving(false); }
  }
  const fieldClass = "mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-3 text-sm";
  return <section className="panel p-5">
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#edf1ee] text-[#557269]"><Sandwich size={17} /></span><div><h2 className="text-sm font-semibold text-[#343b38]">Request catering</h2><p className="mt-0.5 text-xs text-[#858a87]">Send food and drinks to a room without exposing project details.</p></div></div>
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <fieldset className="rounded-lg border border-[#e6e7e2] bg-[#fafbf9] p-3"><legend className="px-1 text-xs font-semibold text-[#4b5752]">Delivery location</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#535b57]">Active room<select value={bookingId} onChange={(event) => { setBookingId(event.target.value); if (event.target.value) setRoomId(""); }} className={fieldClass}><option value="">Choose a room in use</option>{resources.bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.roomName}</option>)}</select></label><label className="text-xs font-medium text-[#535b57]">Other room<select value={roomId} onChange={(event) => { setRoomId(event.target.value); if (event.target.value) setBookingId(""); }} className={fieldClass}><option value="">Choose a room</option>{resources.rooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.type}</option>)}</select></label></div><p className="mt-2 text-[11px] leading-4 text-[#858a87]">Use an active room to keep the request linked to the current booking; otherwise choose the room directly.</p></fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#535b57]">Request type<select value={requestType} onChange={(event) => setRequestType(event.target.value)} className={fieldClass}><option value="lunch">Lunch</option><option value="tea_coffee">Tea / coffee</option><option value="snack">Snack</option></select></label><label className="text-xs font-medium text-[#535b57]">Quantity<input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className={fieldClass} /></label><label className="text-xs font-medium text-[#535b57]">What would you like?<input value={item} onChange={(event) => setItem(event.target.value)} placeholder="Chicken salad, oat flat white…" className={fieldClass} /></label><label className="text-xs font-medium text-[#535b57]">Needed for<input type="datetime-local" value={requestedFor} onChange={(event) => setRequestedFor(event.target.value)} className={fieldClass} /></label></div>
      <label className="block text-xs font-medium text-[#535b57]">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Dietary requirement, collection point, or brief instruction…" className="mt-1.5 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] p-3 text-sm" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ecebe7] pt-4"><p role="status" className={"text-xs " + (message.includes("sent") ? "text-[#4d8068]" : "text-[#a35e41]")}>{message}</p><Button type="submit" variant="primary" isDisabled={saving} className="bg-[#263130] text-white"><Coffee size={15} /> {saving ? "Sending…" : "Send request"}</Button></div>
    </form>
  </section>;
}
