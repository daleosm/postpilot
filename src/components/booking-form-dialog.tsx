"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { CalendarPlus, Clock3, Pencil, Search, ShieldAlert, UserPlus, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

const bookingClientSchema = z.object({
  title: z.string().trim().min(1, "A booking title is required.").max(160),
  episodeId: z.string().optional(), roomId: z.string().optional(), personId: z.string().optional(), guestPersonId: z.string().optional(),
  startsAt: z.string().min(1, "Choose a start time."), endsAt: z.string().min(1, "Choose an end time."),
  setupMinutes: z.number().int().min(0).max(480), handoverMinutes: z.number().int().min(0).max(480),
  status: z.enum(["tentative", "confirmed", "hold", "cancelled"]),
  bookingType: z.enum(["edit", "color", "mix", "qc", "client_review", "ingest", "conform", "leave", "training", "sick", "unavailable"]),
  notes: z.string().max(2000).optional(),
}).superRefine((value, context) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "End must be after the start." });
  if (personnelBookingTypes.includes(value.bookingType as typeof personnelBookingTypes[number])) {
    if (!value.personId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["personId"], message: "Choose the person whose availability is affected." });
    if (value.roomId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["roomId"], message: "Availability bookings cannot reserve a room." });
  }
  if (value.guestPersonId && !value.episodeId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["episodeId"], message: "Choose an episode before adding a guest account." });
});
type BookingValues = z.infer<typeof bookingClientSchema>;
type GuestAccount = { id: string; name: string; role: string; email: string | null };
const newGuestSchema = z.object({ name: z.string().trim().min(2, "Enter the guest's name.").max(120), email: z.string().email("Enter a valid work email.").max(320) });
type NewGuest = z.infer<typeof newGuestSchema>;
export type BookingResources = { episodes: Array<{ id: string; label: string }>; rooms: Array<{ id: string; name: string; type: string }>; people: Array<{ id: string; name: string; role: string; availability: string; isFreelancer: boolean }>; guestAccounts: GuestAccount[] };
export type EditableBooking = { id: string; title: string; startsAt: Date; endsAt: Date; setupMinutes: number; handoverMinutes: number; status: string; bookingType: string; roomId: string | null; episodeId: string | null; personId: string | null; guestPersonId?: string | null; notes: string | null };
type Conflict = { id: string; title: string; startsAt: Date | string; endsAt: Date | string; setupMinutes: number; handoverMinutes: number; bookingType: string; roomName: string | null; personName: string | null; personAvailability: string | null; personIsFreelancer: boolean | null; overlaps: Array<"room" | "person"> };
type Suggestions = { availableRooms: Array<{ id: string; name: string; type: string }>; availablePeople: Array<{ id: string; name: string; role: string; availability: string; isFreelancer: boolean }>; nearestSlot: { startsAt: Date | string; endsAt: Date | string } | null };
const emptySuggestions: Suggestions = { availableRooms: [], availablePeople: [], nearestSlot: null };
const personnelBookingTypes = ["leave", "training", "sick", "unavailable"] as const;
const bookingTypes = ["edit", "color", "mix", "qc", "client_review", "ingest", "conform", ...personnelBookingTypes] as const;

export function BookingFormDialog({ resources, initialStart, booking, onClose }: { resources: BookingResources; initialStart: string; booking?: EditableBooking; onClose?: () => void }) {
  const router = useRouter();
  const editing = Boolean(booking);
  const [open, setOpen] = useState(editing);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(emptySuggestions);
  const [message, setMessage] = useState("");
  const [guestQuery, setGuestQuery] = useState("");
  const [createdGuests, setCreatedGuests] = useState<GuestAccount[]>([]);
  const [creatingGuest, setCreatingGuest] = useState(false);
  const form = useForm<BookingValues>({ resolver: zodResolver(bookingClientSchema), defaultValues: booking ? valuesFor(booking) : blankValues(initialStart) });
  const bookingType = useWatch({ control: form.control, name: "bookingType" });
  const episodeId = useWatch({ control: form.control, name: "episodeId" });
  const guestPersonId = useWatch({ control: form.control, name: "guestPersonId" });
  const guestAccounts = [...resources.guestAccounts, ...createdGuests];
  const selectedGuest = guestAccounts.find((guest) => guest.id === guestPersonId) ?? null;
  const matchingGuests = guestAccounts.filter((guest) => `${guest.name} ${guest.email ?? ""} ${guest.role}`.toLowerCase().includes(guestQuery.trim().toLowerCase())).slice(0, 6);
  const isAvailabilityBooking = personnelBookingTypes.includes(bookingType as typeof personnelBookingTypes[number]);
  const close = () => { setOpen(false); onClose?.(); };
  const acceptAvailability = (body: { conflicts?: Conflict[]; availableRooms?: Suggestions["availableRooms"]; availablePeople?: Suggestions["availablePeople"]; nearestSlot?: Suggestions["nearestSlot"] }) => {
    setConflicts(body.conflicts ?? []);
    setSuggestions({ availableRooms: body.availableRooms ?? [], availablePeople: body.availablePeople ?? [], nearestSlot: body.nearestSlot ?? null });
  };

  const checkAvailability = form.handleSubmit(async (values) => {
    setMessage("");
    const response = await fetch("/api/bookings/conflicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...normalize(values), excludeBookingId: booking?.id }) });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error ?? "Could not check availability.");
    acceptAvailability(body);
    if (!(body.conflicts ?? []).length) setMessage("No room or artist conflicts found.");
  });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    const response = await fetch(booking ? `/api/bookings/${booking.id}` : "/api/bookings", { method: booking ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(normalize(values)) });
    const body = await response.json();
    if (response.status === 409) { acceptAvailability(body); return setMessage(body.error); }
    if (!response.ok) return setMessage(body.error ?? "Could not save booking.");
    close(); setConflicts([]); setSuggestions(emptySuggestions); router.refresh();
  });
  const applySlot = () => { if (!suggestions.nearestSlot) return; form.setValue("startsAt", toInput(suggestions.nearestSlot.startsAt), { shouldDirty: true }); form.setValue("endsAt", toInput(suggestions.nearestSlot.endsAt), { shouldDirty: true }); };

  return <>
    {!editing && <Button variant="primary" onPress={() => setOpen(true)} className="bg-[#263130] text-white"><CalendarPlus size={16} /> New booking</Button>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit booking" : "New booking"}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{editing ? "Edit booking" : "Book a post suite"}</h2><p className="mt-1 text-sm text-[#767c78]">{editing ? "Change the reservation, resources, or booking status." : "Reserve rooms and artists against an episode."}</p></div><Button isIconOnly variant="tertiary" onPress={close} aria-label="Close booking form"><X size={18} /></Button></div>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Field label="Booking title" error={form.formState.errors.title?.message}><input {...form.register("title")} placeholder="SN104 final mix" /></Field>
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Booking type" error={form.formState.errors.bookingType?.message}><select {...form.register("bookingType", { onChange: (event) => { if (personnelBookingTypes.includes(event.target.value)) { form.setValue("roomId", "", { shouldDirty: true }); form.setValue("episodeId", "", { shouldDirty: true }); form.setValue("guestPersonId", "", { shouldDirty: true }); } } })}>{bookingTypes.map((type) => <option key={type} value={type}>{bookingTypeLabel(type)}</option>)}</select></Field><Field label="Room / suite" error={form.formState.errors.roomId?.message}><select disabled={isAvailabilityBooking} {...form.register("roomId")}><option value="">No room</option>{resources.rooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.type.replaceAll("_", " ")}</option>)}</select></Field><Field label={isAvailabilityBooking ? "Person" : "Assigned artist"} error={form.formState.errors.personId?.message}><select {...form.register("personId")}><option value="">{isAvailabilityBooking ? "Choose person" : "Unassigned"}</option>{resources.people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role.replaceAll("_", " ")}{person.isFreelancer ? " · Freelance" : ""} · {availabilityLabel(person.availability)}</option>)}</select></Field></div>
          {isAvailabilityBooking && <p className="-mt-1 text-xs text-[#767c78]">This is a non-project personnel booking. It blocks the person’s availability without reserving a suite or linking an episode.</p>}
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Episode" error={form.formState.errors.episodeId?.message}><select disabled={isAvailabilityBooking} {...form.register("episodeId")}><option value="">Not episode-linked</option>{resources.episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></Field><GuestAccountPicker disabled={isAvailabilityBooking} selectedGuest={selectedGuest} guests={matchingGuests} query={guestQuery} onQueryChange={(value) => { setGuestQuery(value); if (selectedGuest && value !== selectedGuest.name) form.setValue("guestPersonId", "", { shouldDirty: true }); }} onSelect={(id) => { const guest = guestAccounts.find((account) => account.id === id); form.setValue("guestPersonId", id, { shouldDirty: true }); setGuestQuery(guest?.name ?? ""); }} onClear={() => { form.setValue("guestPersonId", "", { shouldDirty: true }); setGuestQuery(""); }} canCreate={Boolean(episodeId)} onCreate={() => setCreatingGuest(true)} /></div>
          <p className="-mt-1 text-xs text-[#767c78]">A guest account is automatically added to the selected episode team when the booking is saved.</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Client booking starts" error={form.formState.errors.startsAt?.message}><input type="datetime-local" {...form.register("startsAt")} /></Field><Field label="Client booking ends" error={form.formState.errors.endsAt?.message}><input type="datetime-local" {...form.register("endsAt")} /></Field></div>
          <div className="rounded-lg border border-[#e4e4df] bg-[#f6f7f4] p-3"><p className="text-xs font-semibold text-[#535b57]">Operational buffers <span className="font-normal text-[#7b817e]">· block room and people, outside client-facing hours</span></p><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label="Setup (min)" error={form.formState.errors.setupMinutes?.message}><input type="number" min="0" max="480" {...form.register("setupMinutes", { valueAsNumber: true })} /></Field><Field label="Handover (min)" error={form.formState.errors.handoverMinutes?.message}><input type="number" min="0" max="480" {...form.register("handoverMinutes", { valueAsNumber: true })} /></Field></div></div>
          <Field label="Status" error={form.formState.errors.status?.message}><select {...form.register("status")}><option value="tentative">Tentative</option><option value="confirmed">Confirmed</option><option value="hold">On hold</option><option value="cancelled">Cancelled</option></select></Field>
          <Field label="Notes" error={form.formState.errors.notes?.message}><textarea rows={3} {...form.register("notes")} placeholder="Client attendees, delivery notes, handoff requirements…" /></Field>
          <ConflictPanel conflicts={conflicts} suggestions={suggestions} message={message} onRoom={(id) => form.setValue("roomId", id, { shouldDirty: true })} onPerson={(id) => form.setValue("personId", id, { shouldDirty: true })} onSlot={applySlot} />
          <div className="flex flex-wrap justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={() => checkAvailability()} className="border border-[#dfe1dd] bg-white text-[#54605b]">Check availability</Button><Button type="button" variant="tertiary" onPress={close}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : editing ? <><Pencil size={15} /> Save changes</> : "Save booking"}</Button></div>
        </form>
      </div>
    </div>}
    {creatingGuest && episodeId && <NewGuestAccountDialog episodeId={episodeId} onClose={() => setCreatingGuest(false)} onCreated={(guest) => { setCreatedGuests((current) => [...current, guest]); form.setValue("guestPersonId", guest.id, { shouldDirty: true }); setGuestQuery(guest.name); setCreatingGuest(false); }} />}
  </>;
}

function ConflictPanel({ conflicts, suggestions, message, onRoom, onPerson, onSlot }: { conflicts: Conflict[]; suggestions: Suggestions; message: string; onRoom: (id: string) => void; onPerson: (id: string) => void; onSlot: () => void }) {
  if (!message && !conflicts.length) return null;
  const hasAlternatives = suggestions.availableRooms.length || suggestions.availablePeople.length || suggestions.nearestSlot;
  return <div className={`rounded-lg p-3 text-xs ${conflicts.length ? "border border-[#efd6ca] bg-[#fcf1eb] text-[#984f35]" : "border border-[#d9e8e0] bg-[#f0f8f3] text-[#4d7566]"}`}>{conflicts.length > 0 && <><div className="flex items-center gap-1.5 font-semibold"><ShieldAlert size={14} /> {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""} found</div><div className="mt-2 space-y-1">{conflicts.map((conflict) => <p key={conflict.id}><b>{conflict.overlaps.join(" and ")} conflict:</b> {conflict.personName && personnelBookingTypes.includes(conflict.bookingType as typeof personnelBookingTypes[number]) ? `${availabilityBookingLabel(conflict.bookingType)} · ${conflict.personName}${conflict.personIsFreelancer ? " (freelance)" : ""}` : conflict.title} · {formatWindow(conflict.startsAt, conflict.endsAt)}{bufferLabel(conflict.setupMinutes, conflict.handoverMinutes)}{conflict.roomName ? ` · ${conflict.roomName}` : ""}{conflict.personName && !personnelBookingTypes.includes(conflict.bookingType as typeof personnelBookingTypes[number]) ? ` · ${conflict.personName}${conflict.personIsFreelancer ? " (freelance)" : ""}` : ""}</p>)}</div></>}{message && <p className={conflicts.length ? "mt-2" : ""}>{message}</p>}{hasAlternatives && <div className="mt-3 border-t border-[#ecd7cd] pt-3 text-[#735d50]"><p className="font-semibold">Available alternatives</p><div className="mt-2 flex flex-wrap gap-2">{suggestions.availableRooms.map((room) => <Button key={room.id} type="button" size="sm" variant="tertiary" onPress={() => onRoom(room.id)} className="border border-[#d9cfc7] bg-white text-[#5e625e]">{room.name}</Button>)}{suggestions.availablePeople.map((person) => <Button key={person.id} type="button" size="sm" variant="tertiary" onPress={() => onPerson(person.id)} className="border border-[#d9cfc7] bg-white text-[#5e625e]"><UserRound size={12} /> {person.name}{person.isFreelancer ? " · Freelance" : ""} · {availabilityLabel(person.availability)}</Button>)}{suggestions.nearestSlot && <Button type="button" size="sm" variant="tertiary" onPress={onSlot} className="border border-[#d9cfc7] bg-white text-[#5e625e]"><Clock3 size={12} /> Next client slot · {formatWindow(suggestions.nearestSlot.startsAt, suggestions.nearestSlot.endsAt)}</Button>}</div><p className="mt-2 text-[11px]">Selecting an alternative updates the form; check availability again before saving.</p></div>}</div>;
}

function GuestAccountPicker({ disabled, selectedGuest, guests, query, onQueryChange, onSelect, onClear, canCreate, onCreate }: { disabled: boolean; selectedGuest: GuestAccount | null; guests: GuestAccount[]; query: string; onQueryChange: (value: string) => void; onSelect: (id: string) => void; onClear: () => void; canCreate: boolean; onCreate: () => void }) {
  const showMatches = !disabled && Boolean(query.trim()) && query.trim().toLowerCase() !== selectedGuest?.name.toLowerCase();

  return <div className="relative">
    <label className="block text-xs font-medium text-[#535b57]">Guest account</label>
    <div className="mt-1.5 flex h-10 overflow-hidden rounded-md border border-[#dedfda] bg-[#fafbf9]">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3"><Search size={14} className="shrink-0 text-[#858a87]" /><input aria-label="Search guest accounts" disabled={disabled} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search guest accounts…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />{selectedGuest && <button type="button" onClick={onClear} aria-label="Clear selected guest" className="text-[#7b8580] hover:text-[#354b44]"><X size={14} /></button>}</div>
      <Button type="button" size="sm" variant="tertiary" isDisabled={disabled || !canCreate} onPress={onCreate} className="h-full shrink-0 rounded-none border-0 border-l border-[#dedfda] bg-[#f3f5f2] px-3 text-[#52635d]"><UserPlus size={13} /> Create</Button>
    </div>
    {showMatches && <div className="absolute z-20 mt-1 max-h-36 w-full overflow-y-auto rounded-md border border-[#dedfda] bg-[#fafbf9] p-1 shadow-lg">{guests.map((guest) => <button key={guest.id} type="button" onClick={() => onSelect(guest.id)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs hover:bg-[#edf2ee]"><span className="truncate font-medium text-[#46514c]">{guest.name}</span><span className="shrink-0 text-[#858a87]">{guest.role.replaceAll("_", " ")}</span></button>)}{!guests.length && <p className="px-2 py-2 text-xs text-[#858a87]">No guest accounts match.</p>}</div>}
  </div>;
}

function NewGuestAccountDialog({ episodeId, onClose, onCreated }: { episodeId: string; onClose: () => void; onCreated: (guest: GuestAccount) => void }) { const [message, setMessage] = useState(""); const form = useForm<NewGuest>({ resolver: zodResolver(newGuestSchema), defaultValues: { name: "", email: "" } }); const submit = form.handleSubmit(async (values) => { setMessage(""); const response = await fetch("/api/bookings/guest-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, episodeId }) }); const body = await response.json().catch(() => null); if (!response.ok) return setMessage(body?.error ?? "Could not create the guest account."); onCreated(body); }); return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#202725]/30 p-4" role="dialog" aria-modal="true" aria-label="Create guest account"><div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#2d3431]">Create guest account</h2><p className="mt-1 text-sm text-[#767c78]">The guest will be added to this episode team and can sign in with an email code.</p></div><Button isIconOnly variant="tertiary" onPress={onClose} aria-label="Close guest account form"><X size={18} /></Button></div><form className="mt-5 space-y-4" onSubmit={submit}><Field label="Name" error={form.formState.errors.name?.message}><input {...form.register("name")} autoFocus /></Field><Field label="Email" error={form.formState.errors.email?.message}><input type="email" {...form.register("email")} /></Field>{message && <p role="alert" className="text-xs text-[#a35e41]">{message}</p>}<div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={onClose}>Cancel</Button><Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Creating…" : "Create guest"}</Button></div></form></div></div>; }

function blankValues(initialStart: string): BookingValues { return { title: "", episodeId: "", roomId: "", personId: "", guestPersonId: "", startsAt: initialStart, endsAt: shiftHours(initialStart, 4), setupMinutes: 0, handoverMinutes: 0, status: "confirmed", bookingType: "edit", notes: "" }; }
function valuesFor(booking: EditableBooking): BookingValues { return { title: booking.title, episodeId: booking.episodeId ?? "", roomId: booking.roomId ?? "", personId: booking.personId ?? "", guestPersonId: booking.guestPersonId ?? "", startsAt: toInput(booking.startsAt), endsAt: toInput(booking.endsAt), setupMinutes: booking.setupMinutes, handoverMinutes: booking.handoverMinutes, status: booking.status as BookingValues["status"], bookingType: booking.bookingType as BookingValues["bookingType"], notes: booking.notes ?? "" }; }
function normalize(values: BookingValues) { return { ...values, setupMinutes: Number(values.setupMinutes), handoverMinutes: Number(values.handoverMinutes), roomId: values.roomId || null, personId: values.personId || null, episodeId: values.episodeId || null, guestPersonId: values.guestPersonId || null, notes: values.notes || null, startsAt: new Date(values.startsAt).toISOString(), endsAt: new Date(values.endsAt).toISOString() }; }
function shiftHours(value: string, hours: number) { const date = new Date(value); date.setHours(date.getHours() + hours); return toInput(date); }
function toInput(value: Date | string) { const date = new Date(value); const pad = (number: number) => String(number).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function formatWindow(start: Date | string, end: Date | string) { return `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(start))}–${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(end))}`; }
function bookingTypeLabel(type: string) { return type === "leave" ? "Approved leave" : type === "sick" ? "Sick / unavailable" : type.replaceAll("_", " "); }
function availabilityBookingLabel(type: string) { return bookingTypeLabel(type); }
function availabilityLabel(availability: string) { return availability.replaceAll("_", " "); }
function bufferLabel(setup: number, handover: number) { const labels = [[setup, "setup"], [handover, "handover"]].filter(([minutes]) => Number(minutes) > 0).map(([minutes, label]) => `${minutes}m ${label}`); return labels.length ? ` · buffers: ${labels.join(", ")}` : ""; }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:bg-[#fafbf9] [&_input]:px-3 [&_input]:text-sm [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-[#fafbf9] [&_select]:px-2 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:bg-[#fafbf9] [&_textarea]:p-3">{children}</span>{error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}</label>; }
