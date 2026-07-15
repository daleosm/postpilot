"use client";

import { Button } from "@heroui/react";
import { ChevronLeft, ChevronRight, Coffee, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

import { BookingFormDialog, type BookingResources } from "@/components/booking-form-dialog";
import { BookingConflictFlagDialog } from "@/components/booking-conflict-flag-dialog";
import { ActualTimeDialog } from "@/components/actual-time-dialog";

export type ScheduleBooking = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  actualStartsAt: Date | null;
  actualEndsAt: Date | null;
  approvedOvertimeMinutes: number;
  setupMinutes: number;
  handoverMinutes: number;
  status: string;
  bookingType: string;
  roomId: string | null;
  episodeId: string | null;
  personId: string | null;
  guestPersonId: string | null;
  notes: string | null;
  roomName: string | null;
  roomType: string | null;
  episodeTitle: string | null;
  episodeNumber: number | null;
  episodeProductionCode: string | null;
  personName: string | null;
};
type CateringRequest = { id: string; bookingId: string | null; requestedByPersonId: string | null; requestType: string; item: string; requestedFor: Date | null; status: string };

type GanttBooking = { booking: ScheduleBooking; start: number; end: number; lane: number };
type GanttRow = { id: string; name: string; type: string; bookings: GanttBooking[]; lanes: number };

const SUITE_DAY_START = 9 * 60;
const SUITE_DAY_END = 18 * 60;
const MINUTES_IN_SUITE_DAY = SUITE_DAY_END - SUITE_DAY_START;
const HOURS_PER_DAY = MINUTES_IN_SUITE_DAY / 60;
const ROOM_COLUMN_WIDTH = 168;
const DAY_WIDTH = 260;

export function ScheduleBoard({ bookings, rooms, resources, cateringRequests, initialDate, canManage, canSubmitOwnTime, currentPersonId }: { bookings: ScheduleBooking[]; rooms: Array<{ id: string; name: string; type: string }>; resources: BookingResources; cateringRequests: CateringRequest[]; initialDate: string; canManage: boolean; canSubmitOwnTime: boolean; currentPersonId: string | null }) {
  const [view, setView] = useState<"day" | "week">("week");
  const [mode, setMode] = useState<"rooms" | "staff">("rooms");
  const [cursor, setCursor] = useState(() => startOfDay(new Date(initialDate)));
  const [selectedBooking, setSelectedBooking] = useState<ScheduleBooking | null>(null);
  const days = useMemo(() => Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => addDays(cursor, index)), [cursor, view]);
  const rangeEnd = useMemo(() => addDays(cursor, days.length), [cursor, days.length]);
  const visible = useMemo(() => bookings.filter((booking) => overlaps(operationalStart(booking), operationalEnd(booking), cursor, rangeEnd)), [bookings, cursor, rangeEnd]);
  const ganttRows = useMemo(() => buildGanttRows(rooms, visible, cursor, days.length), [rooms, visible, cursor, days.length]);
  const move = (direction: number) => setCursor((current) => addDays(current, direction * (mode === "staff" ? 1 : days.length)));

  return <div className="space-y-4">
    <section className="panel flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button isIconOnly variant="tertiary" onClick={() => move(-1)} className="min-w-0 border border-[#e0e1dc] text-[#6d7571] hover:bg-[#f4f4f1]" aria-label="Previous period"><ChevronLeft size={16} /></Button>
        <p className="min-w-[180px] text-center text-sm font-semibold text-[#3e4743]">{rangeLabel(days)}</p>
        <Button isIconOnly variant="tertiary" onClick={() => move(1)} className="min-w-0 border border-[#e0e1dc] text-[#6d7571] hover:bg-[#f4f4f1]" aria-label="Next period"><ChevronRight size={16} /></Button>
      </div>
      <div className="flex rounded-md border border-[#e0e1dc] bg-[#fafaf8] p-0.5">
        <Button variant="tertiary" onClick={() => setView("day")} className={`h-7 min-w-0 rounded px-3 text-xs font-medium ${view === "day" ? "bg-white text-[#34413d] shadow-sm" : "text-[#7b817e]"}`}>Day</Button>
        <Button variant="tertiary" onClick={() => setView("week")} className={`h-7 min-w-0 rounded px-3 text-xs font-medium ${view === "week" ? "bg-white text-[#34413d] shadow-sm" : "text-[#7b817e]"}`}>Week</Button>
      </div>
      <div className="flex rounded-md border border-[#e0e1dc] bg-[#fafaf8] p-0.5">
        <Button variant="tertiary" onClick={() => setMode("rooms")} className={`h-7 min-w-0 rounded px-3 text-xs font-medium ${mode === "rooms" ? "bg-white text-[#34413d] shadow-sm" : "text-[#7b817e]"}`}>Rooms</Button>
        <Button variant="tertiary" onClick={() => { setMode("staff"); setView("day"); }} className={`h-7 min-w-0 rounded px-3 text-xs font-medium ${mode === "staff" ? "bg-white text-[#34413d] shadow-sm" : "text-[#7b817e]"}`}><UsersRound size={13} /> Staff day</Button>
      </div>
    </section>

    {mode === "rooms" ? <><section>
      <div className="panel overflow-x-auto">
        <div style={{ minWidth: `${ROOM_COLUMN_WIDTH + days.length * DAY_WIDTH}px` }}>
          <GanttHeader days={days} />
          <GanttTimeline rows={ganttRows} days={days.length} onSelect={setSelectedBooking} />
        </div>
      </div>
    </section>
    </> : <StaffDayView people={resources.people} bookings={bookings} cateringRequests={cateringRequests} day={cursor} onSelect={setSelectedBooking} />}
    {selectedBooking && <div className="fixed bottom-5 right-5 z-40 flex flex-wrap gap-2 rounded-lg border border-[#e2e3de] bg-[#fafbf9] p-2 shadow-lg">{canManage && <BookingFormDialog key={selectedBooking.id} resources={resources} initialStart={toInput(cursor)} booking={selectedBooking} onClose={() => setSelectedBooking(null)} />}{canSubmitOwnTime && selectedBooking.personId === currentPersonId && <><ActualTimeDialog booking={selectedBooking} /><BookingConflictFlagDialog bookingId={selectedBooking.id} title={selectedBooking.title} /></>}<Button size="sm" variant="tertiary" onPress={() => setSelectedBooking(null)}>Close</Button></div>}
  </div>;
}

function StaffDayView({ people, bookings, cateringRequests, day, onSelect }: { people: BookingResources["people"]; bookings: ScheduleBooking[]; cateringRequests: CateringRequest[]; day: Date; onSelect: (booking: ScheduleBooking) => void }) {
  const dayEnd = addDays(day, 1);
  const rows = people.map((person) => {
    const next = bookings.filter((booking) => booking.personId === person.id && overlaps(operationalStart(booking), operationalEnd(booking), day, dayEnd)).sort((a, b) => operationalStart(a).getTime() - operationalStart(b).getTime())[0];
    const catering = next ? cateringRequests.filter((request) => request.bookingId === next.id || request.requestedByPersonId === person.id).filter((request) => request.requestedFor && overlaps(request.requestedFor, new Date(request.requestedFor.getTime() + 1), day, dayEnd)).sort((a, b) => (a.requestedFor?.getTime() ?? 0) - (b.requestedFor?.getTime() ?? 0))[0] : undefined;
    return { person, next, catering };
  });
  return <section className="panel overflow-x-auto"><div className="min-w-[820px]"><div className="grid grid-cols-[1.2fr_1.5fr_130px_1.1fr_100px_1.4fr_1fr] gap-3 border-b border-[#ebeae6] bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e837f]"><span>Person</span><span>Next booking</span><span>Call / start</span><span>Room</span><span>Episode</span><span>Handover note</span><span>Catering</span></div><div className="divide-y divide-[#efeeea]">{rows.map(({ person, next, catering }) => <div key={person.id} className="grid grid-cols-[1.2fr_1.5fr_130px_1.1fr_100px_1.4fr_1fr] items-center gap-3 px-5 py-3 text-xs"><div><p className="font-semibold text-[#46514c]">{person.name}{person.isFreelancer ? <span className="ml-1.5 font-normal text-[#7c827f]">Freelance</span> : null}</p><p className="mt-0.5 capitalize text-[#858a87]">{person.role.replaceAll("_", " ")} · {person.availability.replaceAll("_", " ")}</p></div>{next ? <><button type="button" onClick={() => onSelect(next)} className="truncate text-left font-medium text-[#476d63] hover:underline">{next.title}</button><span className="text-[#5e6964]">{timeLabel(operationalStart(next))} call · {timeLabel(next.startsAt)} start</span><span className="truncate text-[#5e6964]">{next.roomName ?? "No room"}</span><span className="font-medium text-[#5e6964]">{next.episodeProductionCode ?? "—"}</span><span className="line-clamp-2 text-[#777f7b]">{next.notes ?? (next.handoverMinutes ? `${next.handoverMinutes} min handover` : "—")}</span><span>{catering ? <span className="inline-flex items-center gap-1 rounded-full bg-[#edf1ee] px-2 py-1 text-[10px] font-semibold text-[#557269]"><Coffee size={11} /> {catering.status.replaceAll("_", " ")}</span> : <span className="text-[#969b98]">None</span>}</span></> : <><span className="col-span-6 text-[#969b98]">No booking scheduled</span></>}</div>)}</div></div></section>;
}

function GanttHeader({ days }: { days: Date[] }) {
  return <div className="grid border-b border-[#ebeae6]" style={{ gridTemplateColumns: `${ROOM_COLUMN_WIDTH}px minmax(0, 1fr)` }}>
    <div className="flex items-end bg-[#fafaf8] px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a8f8c]">Suite / room</div>
    <div className="grid" style={{ gridTemplateColumns: `repeat(${days.length}, ${DAY_WIDTH}px)` }}>
      {days.map((day) => <div key={day.toISOString()} className="border-l border-[#ebeae6] bg-[#fafaf8]"><div className="px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a8f8c]">{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day)}</p><p className="mt-0.5 text-sm font-semibold text-[#3c4440]">{new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(day)}</p></div><div className="grid border-t border-[#efeee9]" style={{ gridTemplateColumns: `repeat(${HOURS_PER_DAY}, 1fr)` }}>{Array.from({ length: HOURS_PER_DAY }, (_, index) => <span key={index} className="border-r border-[#efeee9] px-1 py-1 text-center text-[9px] text-[#939894]">{String(SUITE_DAY_START / 60 + index).padStart(2, "0")}</span>)}</div></div>)}
    </div>
  </div>;
}

function GanttTimeline({ rows, days, onSelect }: { rows: GanttRow[]; days: number; onSelect: (booking: ScheduleBooking) => void }) {
  if (!rows.length) return <p className="px-4 py-6 text-xs text-[#9a9e9b]">No rooms or bookings in this period.</p>;
  return <div>{rows.map((row) => <GanttRoomRow key={row.id} row={row} days={days} onSelect={onSelect} />)}</div>;
}

function GanttRoomRow({ row, days, onSelect }: { row: GanttRow; days: number; onSelect: (booking: ScheduleBooking) => void }) {
  const rowHeight = Math.max(52, row.lanes * 48 + 8);
  const totalMinutes = days * MINUTES_IN_SUITE_DAY;
  return <div className="grid border-b border-[#ebeae6]" style={{ gridTemplateColumns: `${ROOM_COLUMN_WIDTH}px minmax(0, 1fr)`, minHeight: `${rowHeight}px` }}>
    <div className="flex flex-col justify-center border-r border-[#ebeae6] bg-[#fcfcfa] px-3"><p className="truncate text-xs font-semibold text-[#4b5550]">{row.name}</p><p className="mt-0.5 truncate text-[10px] capitalize text-[#959a96]">{row.type.replaceAll("_", " ")}</p></div>
    <div className="relative bg-[#fafbf9]" style={{ minHeight: `${rowHeight}px` }}>
      <TimelineGrid days={days} />
      {row.bookings.map((placement) => <GanttBookingBar key={placement.booking.id} placement={placement} totalMinutes={totalMinutes} onSelect={onSelect} />)}
      {!row.bookings.length && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-[#a2a6a2]">Available</span>}
    </div>
  </div>;
}

function TimelineGrid({ days }: { days: number }) {
  return <><div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days * HOURS_PER_DAY}, 1fr)` }}>{Array.from({ length: days * HOURS_PER_DAY }, (_, index) => <div key={index} className="border-r border-[#efeee9]" />)}</div><div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, 1fr)` }}>{Array.from({ length: days }, (_, index) => <div key={index} className="border-r border-[#dddeda] last:border-r-0" />)}</div></>;
}

function GanttBookingBar({ placement, totalMinutes, onSelect }: { placement: GanttBooking; totalMinutes: number; onSelect: (booking: ScheduleBooking) => void }) {
  const { booking } = placement;
  return <button type="button" onClick={() => onSelect(booking)} aria-label={`Edit ${booking.title}`} title={`Client: ${timeLabel(booking.startsAt)}–${timeLabel(booking.endsAt)}. Operational: ${timeLabel(operationalStart(booking))}–${timeLabel(operationalEnd(booking))}.`} style={{ top: `${placement.lane * 48 + 4}px`, left: `calc(${(placement.start / totalMinutes) * 100}% + 3px)`, width: `calc(${Math.max(1.5, ((placement.end - placement.start) / totalMinutes) * 100)}% - 6px)` }} className={`absolute h-10 overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left shadow-sm transition-shadow hover:z-10 hover:shadow-md focus:z-10 focus:outline-none focus:ring-2 focus:ring-[#66877f] ${bookingColors(booking.bookingType)}`}><p className="truncate text-[11px] font-semibold text-[#414945]">{booking.title}</p><p className="mt-0.5 truncate text-[10px] text-[#68716d]">{booking.actualStartsAt ? `Actual ${timeLabel(booking.actualStartsAt)}–${booking.actualEndsAt ? timeLabel(booking.actualEndsAt) : "—"}` : `Client ${timeLabel(booking.startsAt)}–${timeLabel(booking.endsAt)}`} · {booking.personName ?? "Unassigned"}</p></button>;
}

function buildGanttRows(rooms: Array<{ id: string; name: string; type: string }>, bookings: ScheduleBooking[], rangeStart: Date, days: number): GanttRow[] {
  const roomRows = rooms.map((room) => ({ id: room.id, name: room.name, type: room.type, bookings: [] as ScheduleBooking[] }));
  const roomsById = new Map(roomRows.map((room) => [room.id, room]));
  const unassigned: ScheduleBooking[] = [];
  const personnelAvailability: ScheduleBooking[] = [];
  for (const booking of bookings) {
    const room = booking.roomId ? roomsById.get(booking.roomId) : undefined;
    if (room) room.bookings.push(booking);
    else if (isPersonnelAvailabilityBooking(booking.bookingType)) personnelAvailability.push(booking);
    else unassigned.push(booking);
  }
  const rows = roomRows.map((row) => ({ ...row, ...layoutRoomBookings(row.bookings, rangeStart, days) }));
  if (personnelAvailability.length) rows.push({ id: "personnel-availability", name: "Personnel availability", type: "leave, training & unavailable", ...layoutRoomBookings(personnelAvailability, rangeStart, days) });
  if (unassigned.length) rows.push({ id: "unassigned", name: "Unassigned suite", type: "needs allocation", ...layoutRoomBookings(unassigned, rangeStart, days) });
  return rows;
}

function layoutRoomBookings(bookings: ScheduleBooking[], rangeStart: Date, days: number) {
  const rangeEnd = addDays(rangeStart, days);
  const totalMinutes = days * MINUTES_IN_SUITE_DAY;
  const laneEnds: number[] = [];
  const placements = bookings.map((booking) => ({ booking, start: businessTimelineMinute(operationalStart(booking), rangeStart), end: businessTimelineMinute(operationalEnd(booking), rangeStart) })).map((placement) => ({ ...placement, start: Math.max(0, placement.start), end: Math.min(totalMinutes, Math.max(placement.start + 15, placement.end)) })).filter((placement) => overlaps(operationalStart(placement.booking), operationalEnd(placement.booking), rangeStart, rangeEnd)).sort((a, b) => a.start - b.start).map((placement) => { const existingLane = laneEnds.findIndex((end) => end <= placement.start); const lane = existingLane === -1 ? laneEnds.length : existingLane; laneEnds[lane] = placement.end; return { ...placement, lane }; });
  return { bookings: placements, lanes: Math.max(1, laneEnds.length) };
}

function businessTimelineMinute(value: Date, rangeStart: Date) { const dayIndex = calendarDayDistance(rangeStart, value); const minuteInDay = minutesOfDay(value); return dayIndex * MINUTES_IN_SUITE_DAY + Math.min(MINUTES_IN_SUITE_DAY, Math.max(0, minuteInDay - SUITE_DAY_START)); }
function bookingColors(type: string) { return { edit: "border-l-[#5f7ee6] bg-[#eff3ff]", color: "border-l-[#9b70e5] bg-[#f5effc]", mix: "border-l-[#4f9a79] bg-[#edf7f2]", qc: "border-l-[#c2764f] bg-[#fcf1eb]", client_review: "border-l-[#c49b4b] bg-[#faf5e8]", ingest: "border-l-[#74899a] bg-[#f0f4f6]", conform: "border-l-[#817eaa] bg-[#f2f1fa]", leave: "border-l-[#b75f75] bg-[#fceff2]", training: "border-l-[#4b8da0] bg-[#eef7f9]", sick: "border-l-[#c2764f] bg-[#fcf1eb]", unavailable: "border-l-[#797d87] bg-[#f1f2f4]" }[type] ?? "border-l-[#74899a] bg-[#f0f4f6]"; }
function isPersonnelAvailabilityBooking(type: string) { return ["leave", "training", "sick", "unavailable"].includes(type); }
function startOfDay(date: Date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function addDays(date: Date, count: number) { const value = new Date(date); value.setDate(value.getDate() + count); return value; }
function overlaps(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) { return start < rangeEnd && end > rangeStart; }
function operationalStart(booking: ScheduleBooking) { return new Date(booking.startsAt.getTime() - booking.setupMinutes * 60_000); }
function operationalEnd(booking: ScheduleBooking) { return new Date(booking.endsAt.getTime() + booking.handoverMinutes * 60_000); }
function calendarDayDistance(rangeStart: Date, value: Date) { return Math.floor((startOfDay(value).getTime() - rangeStart.getTime()) / 86_400_000); }
function minutesOfDay(date: Date) { return date.getHours() * 60 + date.getMinutes(); }
function timeLabel(date: Date) { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function toInput(date: Date) { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function rangeLabel(days: Date[]) { if (days.length === 1) return new Intl.DateTimeFormat("en-GB", { weekday: "long", month: "long", day: "numeric" }).format(days[0]); return `${new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(days[0])} – ${new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(days.at(-1)!)} `; }
