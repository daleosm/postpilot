"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { Building2, Pencil, Plus, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const roomTypes = [
  ["edit_bay", "Edit bay"],
  ["color_suite", "Colour suite"],
  ["mix_room", "Mix room"],
  ["qc_room", "QC room"],
  ["client_review", "Client review room"],
  ["machine_room", "Machine room"],
  ["other", "Other"],
] as const;

const roomSchema = z.object({
  name: z.string().trim().min(1, "Room name is required.").max(80),
  type: z.string().min(1, "Choose a room type.").max(60),
  location: z.string().trim().max(120).optional(),
  capacity: z.coerce.number().int().positive("Capacity must be at least 1.").optional(),
  notes: z.string().trim().max(2000).optional(),
});
type RoomValues = z.infer<typeof roomSchema>;
type RoomInput = z.input<typeof roomSchema>;
export type RoomSetupItem = { id: string; name: string; type: string; location: string | null; capacity: number | null; notes: string | null };

export function RoomSetup({ rooms }: { rooms: RoomSetupItem[] }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-center">
        <div><h2 className="text-sm font-semibold text-[#343b38]">Rooms & suites</h2><p className="mt-1 text-xs text-[#858a87]">These are the bookable resources available to this post house only.</p></div>
        <RoomDialog />
      </div>
      <div className="divide-y divide-[#efeeea]">
        {rooms.map((room) => <RoomRow key={room.id} room={room} />)}
        {!rooms.length && <div className="px-5 py-12 text-center"><Building2 className="mx-auto text-[#a1a7a3]" size={22} /><p className="mt-3 text-sm font-medium text-[#59615d]">No rooms set up yet</p><p className="mt-1 text-xs text-[#858a87]">Add an edit bay, suite, or room before making bookings.</p></div>}
      </div>
    </section>
  );
}

function RoomRow({ room }: { room: RoomSetupItem }) {
  return <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-[#404844]">{room.name}</p><span className="rounded bg-[#edf1ee] px-1.5 py-0.5 text-[10px] font-semibold text-[#5b716a]">{roomTypeLabel(room.type)}</span></div><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#7d837f]"><span>{room.location || "Location not set"}</span>{room.capacity && <span className="inline-flex items-center gap-1"><UsersRound size={12} /> {room.capacity} seats</span>}{room.notes && <span className="max-w-lg truncate">{room.notes}</span>}</div></div><RoomDialog room={room} /></div>;
}

function RoomDialog({ room }: { room?: RoomSetupItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<RoomInput, unknown, RoomValues>({ resolver: zodResolver(roomSchema), defaultValues: defaults(room) });

  function close() { setOpen(false); setError(""); form.reset(defaults(room)); }
  async function submit(values: RoomValues) {
    setError("");
    const payload = { ...values, location: values.location || null, capacity: values.capacity || null, notes: values.notes || null };
    const response = await fetch(room ? `/api/rooms/${room.id}` : "/api/rooms", { method: room ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return setError(body?.error ?? "Could not save this room.");
    close();
    router.refresh();
  }

  return <><Button variant={room ? "tertiary" : "primary"} onPress={() => setOpen(true)} className={room ? "min-w-0 border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>{room ? <><Pencil size={14} /> Edit</> : <><Plus size={16} /> Add room</>}</Button>{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4"><div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#e2e3de] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{room ? "Edit room" : "Add a room"}</h2><p className="mt-1 text-sm text-[#767c78]">This resource will be available only in this post house’s booking calendar.</p></div><Button isIconOnly variant="tertiary" onPress={close} aria-label="Close" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div><form className="mt-6 space-y-4" onSubmit={form.handleSubmit(submit)}><Field label="Room name" error={form.formState.errors.name?.message}><input {...form.register("name")} placeholder="Edit Bay 3" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Room type" error={form.formState.errors.type?.message}><select {...form.register("type")}>{roomTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Capacity" error={form.formState.errors.capacity?.message}><input type="number" min="1" {...form.register("capacity")} placeholder="4" /></Field></div><Field label="Location" error={form.formState.errors.location?.message}><input {...form.register("location")} placeholder="Finishing floor" /></Field><Field label="Notes" error={form.formState.errors.notes?.message}><textarea rows={3} {...form.register("notes")} placeholder="Equipment, access notes, or room setup…" /></Field>{error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}<div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={close}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : room ? "Save room" : "Add room"}</Button></div></form></div></div>}</>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:px-3 [&_input]:text-sm [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-white [&_select]:px-2 [&_select]:text-sm [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:p-3 [&_textarea]:text-sm">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>; }
function defaults(room?: RoomSetupItem): RoomInput { return { name: room?.name ?? "", type: room?.type ?? "edit_bay", location: room?.location ?? "", capacity: room?.capacity ?? undefined, notes: room?.notes ?? "" }; }
function roomTypeLabel(type: string) { return roomTypes.find(([value]) => value === type)?.[1] ?? type.replaceAll("_", " "); }
