"use client";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";
import { FormLayout, OperationalPanel } from "@/components/operations-ui";

import { Button } from "@heroui/react";
import { Coffee, Sandwich } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Resources = { rooms: Array<{ id: string; name: string; type: string }>; activeBooking: { id: string; roomId: string; roomName: string } | null };

export function CateringRequestForm({ resources }: { resources: Resources }) {
  const router = useRouter();
  const [roomId, setRoomId] = useState(resources.activeBooking?.roomId ?? "");
  const [requestType, setRequestType] = useState("lunch");
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [requestedFor, setRequestedFor] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!item.trim() || !roomId) return setMessage("Choose a room and describe the request.");
    setSaving(true); setMessage("");
    try {
      const response = await postpilotUiFetch("/v1/catering-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: resources.activeBooking?.id ?? null, roomId, requestType, item, quantity, requestedFor: requestedFor ? new Date(requestedFor).toISOString() : null, notes: notes || null }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not send your request.");
      setItem(""); setQuantity(1); setRequestedFor(""); setNotes(""); setMessage("Request sent to the runner desk."); router.refresh();
    } catch { setMessage("Could not send your request."); } finally { setSaving(false); }
  }
  const fieldClass = "control mt-1.5 text-sm";
  return <OperationalPanel className="p-5">
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#edf1ee] text-[#557269]"><Sandwich size={17} /></span><div><h2 className="text-sm font-semibold text-[#343b38]">Request catering</h2><p className="mt-0.5 text-xs text-[#858a87]">Send food and drinks to a room without exposing project details.</p></div></div>
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <fieldset className="rounded-lg border border-[#e6e7e2] bg-[#fafbf9] p-3"><legend className="px-1 text-xs font-semibold text-[#4b5752]">Delivery location</legend><label className="block text-xs font-medium text-[#535b57]">Room<select value={roomId} onChange={(event) => setRoomId(event.target.value)} className={fieldClass}><option value="">Choose a room</option>{resources.rooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.type}</option>)}</select></label><p className="mt-2 text-[11px] leading-4 text-[#858a87]">{resources.activeBooking ? `Preselected from your active booking in ${resources.activeBooking.roomName}. Change it if you moved rooms; the request still bills that booking’s episode.` : "No active booking was found, so this request will not be attached to an episode automatically."}</p></fieldset>
      <FormLayout><label className="text-xs font-medium text-[#535b57]">Request type<select value={requestType} onChange={(event) => setRequestType(event.target.value)} className={fieldClass}><option value="lunch">Lunch</option><option value="tea_coffee">Tea / coffee</option><option value="snack">Snack</option></select></label><label className="text-xs font-medium text-[#535b57]">Quantity<input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className={fieldClass} /></label><label className="text-xs font-medium text-[#535b57]">What would you like?<input value={item} onChange={(event) => setItem(event.target.value)} placeholder="Chicken salad, oat flat white…" className={fieldClass} /></label><label className="text-xs font-medium text-[#535b57]">Needed for<input type="datetime-local" value={requestedFor} onChange={(event) => setRequestedFor(event.target.value)} className={fieldClass} /></label></FormLayout>
      <label className="block text-xs font-medium text-[#535b57]">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Dietary requirement, collection point, or brief instruction…" className="control mt-1.5 text-sm" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ecebe7] pt-4"><p role="status" className={"text-xs " + (message.includes("sent") ? "text-[#4d8068]" : "text-[#a35e41]")}>{message}</p><Button type="submit" variant="primary" isDisabled={saving} className="bg-[#263130] text-white"><Coffee size={15} /> {saving ? "Sending…" : "Send request"}</Button></div>
    </form>
  </OperationalPanel>;
}
