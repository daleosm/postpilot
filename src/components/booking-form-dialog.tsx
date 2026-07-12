"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { CalendarPlus, Pencil, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const bookingClientSchema = z.object({
  title: z.string().trim().min(1, "A booking title is required.").max(160),
  episodeId: z.string().optional(), roomId: z.string().optional(), personId: z.string().optional(),
  startsAt: z.string().min(1, "Choose a start time."), endsAt: z.string().min(1, "Choose an end time."),
  status: z.enum(["tentative", "confirmed", "hold", "cancelled"]),
  bookingType: z.enum(["edit", "color", "mix", "qc", "client_review", "ingest", "conform"]),
  notes: z.string().max(2000).optional(),
}).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), { path: ["endsAt"], message: "End must be after the start." });
type BookingValues = z.infer<typeof bookingClientSchema>;
export type BookingResources = { episodes: Array<{ id: string; label: string }>; rooms: Array<{ id: string; name: string; type: string }>; people: Array<{ id: string; name: string; role: string }> };
export type EditableBooking = { id: string; title: string; startsAt: Date; endsAt: Date; status: string; bookingType: string; roomId: string | null; episodeId: string | null; personId: string | null; notes: string | null };

/** Used for both new reservations and changing an existing calendar item. */
export function BookingFormDialog({ resources, initialStart, booking, onClose }: { resources: BookingResources; initialStart: string; booking?: EditableBooking; onClose?: () => void }) {
  const router = useRouter();
  const editing = Boolean(booking);
  const [open, setOpen] = useState(editing);
  const [conflicts, setConflicts] = useState<Array<{ id: string; title: string; roomName: string | null; personName: string | null }>>([]);
  const [message, setMessage] = useState("");
  const form = useForm<BookingValues>({ resolver: zodResolver(bookingClientSchema), defaultValues: booking ? valuesFor(booking) : blankValues(initialStart) });
  const close = () => { setOpen(false); onClose?.(); };

  const checkAvailability = form.handleSubmit(async (values) => {
    setMessage("");
    const response = await fetch("/api/bookings/conflicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...normalize(values), excludeBookingId: booking?.id }) });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error ?? "Could not check availability.");
    setConflicts(body.conflicts ?? []);
    if (!(body.conflicts ?? []).length) setMessage("No room or artist conflicts found.");
  });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    const response = await fetch(booking ? `/api/bookings/${booking.id}` : "/api/bookings", { method: booking ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(normalize(values)) });
    const body = await response.json();
    if (response.status === 409) { setConflicts(body.conflicts ?? []); return setMessage(body.error); }
    if (!response.ok) return setMessage(body.error ?? "Could not save booking.");
    close(); setConflicts([]); router.refresh();
  });

  return <>{!editing && <Button variant="primary" onPress={() => setOpen(true)} className="bg-[#263130] text-white"><CalendarPlus size={16} /> New booking</Button>}{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit booking" : "New booking"}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#e2e3de] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{editing ? "Edit booking" : "Book a post suite"}</h2><p className="mt-1 text-sm text-[#767c78]">{editing ? "Change the reservation, resources, or booking status." : "Reserve rooms and artists against an episode."}</p></div><Button isIconOnly variant="tertiary" onPress={close} aria-label="Close booking form" className="min-w-0 text-[#7d827e] hover:bg-[#f0f1ed]"><X size={18} /></Button></div><form className="mt-6 space-y-4" onSubmit={submit}><Field label="Booking title" error={form.formState.errors.title?.message}><input {...form.register("title")} placeholder="SN104 final mix" /></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="Booking type" error={form.formState.errors.bookingType?.message}><select {...form.register("bookingType")}>{["edit", "color", "mix", "qc", "client_review", "ingest", "conform"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></Field><Field label="Room / suite" error={form.formState.errors.roomId?.message}><select {...form.register("roomId")}><option value="">No room</option>{resources.rooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.type.replaceAll("_", " ")}</option>)}</select></Field><Field label="Assigned artist" error={form.formState.errors.personId?.message}><select {...form.register("personId")}><option value="">Unassigned</option>{resources.people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role.replaceAll("_", " ")}</option>)}</select></Field></div><Field label="Episode" error={form.formState.errors.episodeId?.message}><select {...form.register("episodeId")}><option value="">Not episode-linked</option>{resources.episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Start" error={form.formState.errors.startsAt?.message}><input type="datetime-local" {...form.register("startsAt")} /></Field><Field label="End" error={form.formState.errors.endsAt?.message}><input type="datetime-local" {...form.register("endsAt")} /></Field></div><Field label="Status" error={form.formState.errors.status?.message}><select {...form.register("status")}><option value="tentative">Tentative</option><option value="confirmed">Confirmed</option><option value="hold">On hold</option><option value="cancelled">Cancelled</option></select></Field><Field label="Notes" error={form.formState.errors.notes?.message}><textarea rows={3} {...form.register("notes")} placeholder="Client attendees, delivery notes, handoff requirements…" /></Field>{(message || conflicts.length > 0) && <div className={`rounded-lg p-3 text-xs ${conflicts.length ? "border border-[#efd6ca] bg-[#fcf1eb] text-[#984f35]" : "border border-[#d9e8e0] bg-[#f0f8f3] text-[#4d7566]"}`}>{conflicts.length > 0 && <div className="mb-2 flex items-center gap-1.5 font-semibold"><ShieldAlert size={14} /> {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""} found</div>}{conflicts.map((conflict) => <p key={conflict.id}>{conflict.title} · {conflict.roomName ?? conflict.personName ?? "resource booked"}</p>)}{message && <p>{message}</p>}</div>}<div className="flex flex-wrap justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={() => checkAvailability()} className="border border-[#dfe1dd] bg-white text-[#54605b]">Check availability</Button><Button type="button" variant="tertiary" onPress={close} className="text-[#59615e]">Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : editing ? <><Pencil size={15} /> Save changes</> : "Save booking"}</Button></div></form></div></div>}</>;
}

function blankValues(initialStart: string): BookingValues { return { title: "", episodeId: "", roomId: "", personId: "", startsAt: initialStart, endsAt: shiftHours(initialStart, 4), status: "confirmed", bookingType: "edit", notes: "" }; }
function valuesFor(booking: EditableBooking): BookingValues { return { title: booking.title, episodeId: booking.episodeId ?? "", roomId: booking.roomId ?? "", personId: booking.personId ?? "", startsAt: toInput(booking.startsAt), endsAt: toInput(booking.endsAt), status: booking.status as BookingValues["status"], bookingType: booking.bookingType as BookingValues["bookingType"], notes: booking.notes ?? "" }; }
function normalize(values: BookingValues) { return { ...values, roomId: values.roomId || null, personId: values.personId || null, episodeId: values.episodeId || null, notes: values.notes || null, startsAt: new Date(values.startsAt).toISOString(), endsAt: new Date(values.endsAt).toISOString() }; }
function shiftHours(value: string, hours: number) { const date = new Date(value); date.setHours(date.getHours() + hours); return toInput(date); }
function toInput(value: Date | string) { const date = new Date(value); const pad = (number: number) => String(number).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input:focus]:border-[#66877f] [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-white [&_select]:px-2 [&_select]:text-sm [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:p-3 [&_textarea]:text-sm">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>; }
