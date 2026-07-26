"use client";

import { Button } from "@heroui/react";
import { ChevronLeft, ChevronRight, Coffee, GripVertical, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

import { BookingFormDialog, type BookingResources } from "@/components/booking-form-dialog";
import { BookingConflictFlagDialog } from "@/components/booking-conflict-flag-dialog";
import { ActualTimeDialog } from "@/components/actual-time-dialog";
import { ScheduleWorkOrderDialog, type SchedulableWorkOrder } from "@/components/schedule-work-order-dialog";

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
  isOption: boolean;
  optionRank: number | null;
  status: string;
  bookingType: string;
  roomId: string | null;
  episodeId: string | null;
  personId: string | null;
  guestPersonId: string | null;
  notes: string | null;
  workOrderId: string | null;
  roomName: string | null;
  roomType: string | null;
  episodeTitle: string | null;
  episodeNumber: number | null;
  episodeProductionCode: string | null;
  personName: string | null;
  workflowState?: { displayStatus: string; primaryStageName: string | null } | null;
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

export function ScheduleBoard({ bookings, rooms, resources, cateringRequests, workOrders, initialDate, initialWorkOrderId, canManage, canSubmitOwnTime, currentPersonId }: { bookings: ScheduleBooking[]; rooms: Array<{ id: string; name: string; type: string }>; resources: BookingResources; cateringRequests: CateringRequest[]; workOrders: Array<SchedulableWorkOrder & { bookingId: string | null; workType: string; assigneePersonId: string | null; status: string }>; initialDate: string; initialWorkOrderId: string | null; canManage: boolean; canSubmitOwnTime: boolean; currentPersonId: string | null }) {
  const [view, setView] = useState<"day" | "week">("week");
  const [mode, setMode] = useState<"rooms" | "staff">("rooms");
  const [cursor, setCursor] = useState(() => startOfDay(new Date(initialDate)));
  const [selectedBooking, setSelectedBooking] = useState<ScheduleBooking | null>(null);
  const [draggedWorkOrder, setDraggedWorkOrder] = useState<SchedulableWorkOrder | null>(null);
  const [pendingReservation, setPendingReservation] = useState<{ workOrder: SchedulableWorkOrder; roomId: string; startsAt: Date } | null>(null);
  const days = useMemo(() => Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => addDays(cursor, index)), [cursor, view]);
  const rangeEnd = useMemo(() => addDays(cursor, days.length), [cursor, days.length]);
  const visible = useMemo(() => bookings.filter((booking) => overlaps(operationalStart(booking), operationalEnd(booking), cursor, rangeEnd)), [bookings, cursor, rangeEnd]);
  const ganttRows = useMemo(() => buildGanttRows(rooms, visible, cursor, days.length), [rooms, visible, cursor, days.length]);
  const conflictingBookingIds = useMemo(() => bookingConflictIds(visible), [visible]);
  const move = (direction: number) => setCursor((current) => addDays(current, direction * (mode === "staff" ? 1 : days.length)));

  const availableWorkOrders = useMemo(
    () => workOrders.filter((workOrder) => workOrder.workType === "internal" && ["in_progress", "ready_for_review"].includes(workOrder.status) && !workOrder.bookingId),
    [workOrders],
  );
  return <div className="space-y-4">
    {canSubmitOwnTime && availableWorkOrders.length > 0 && <section className="panel border-[#dce6de] bg-[#f8fbf8] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#3e5148]">Ready to schedule</p><p className="mt-0.5 text-xs text-[#718078]">Drag an assigned work order onto a free room slot to reserve it, or select one with the keyboard. The booking stays linked to the work for actual-time costing.</p></div><span className="rounded-full bg-[#e6f0e8] px-2 py-1 text-[10px] font-semibold text-[#527161]">{availableWorkOrders.length} available</span></div><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{availableWorkOrders.map((workOrder) => <button key={workOrder.id} draggable aria-label={`Reserve work order ${workOrder.title}`} onClick={() => setPendingReservation({ workOrder, roomId: "", startsAt: suiteDayStart(cursor) })} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", workOrder.id); setDraggedWorkOrder(workOrder); }} onDragEnd={() => setDraggedWorkOrder(null)} className={`flex min-w-[230px] max-w-[290px] items-start gap-2 rounded-lg border bg-white px-3 py-2 text-left shadow-sm transition hover:border-[#8ba594] hover:shadow ${workOrder.id === initialWorkOrderId ? "border-[#4f806f] ring-2 ring-[#cfe1d6]" : "border-[#dce5de]"}`}><GripVertical className="mt-0.5 shrink-0 text-[#93a299]" size={15} /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-[#3f4b45]">{workOrder.title}</span><span className="mt-0.5 block truncate text-[10px] text-[#77827c]">{workOrder.showTitle} · E{String(workOrder.episodeNumber).padStart(2, "0")} · {workOrder.workflowStageName ?? "General work"}</span>{workOrder.id === initialWorkOrderId && <span className="mt-1 block text-[10px] font-semibold text-[#3f7563]">Selected from My work · drag to a room</span>}</span></button>)}</div></section>}
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
    <BookingLegend />

    {mode === "rooms" ? <><section>
      <div className="panel overflow-x-auto">
        <div style={{ minWidth: `${ROOM_COLUMN_WIDTH + days.length * DAY_WIDTH}px` }}>
          <GanttHeader days={days} />
          <GanttTimeline rows={ganttRows} days={days.length} rangeStart={cursor} conflictingBookingIds={conflictingBookingIds} draggedWorkOrder={draggedWorkOrder} onDropWorkOrder={(roomId, startsAt) => { if (draggedWorkOrder) setPendingReservation({ workOrder: draggedWorkOrder, roomId, startsAt }); setDraggedWorkOrder(null); }} onSelect={setSelectedBooking} />
        </div>
      </div>
    </section>
    </> : <StaffDayView people={resources.people} bookings={bookings} cateringRequests={cateringRequests} day={cursor} onSelect={setSelectedBooking} />}
    {selectedBooking && <div className="fixed bottom-5 right-5 z-40 flex flex-wrap gap-2 rounded-lg border border-[#e2e3de] bg-[#fafbf9] p-2 shadow-lg">{canManage && <BookingFormDialog key={selectedBooking.id} resources={resources} initialStart={toInput(cursor)} booking={selectedBooking} onClose={() => setSelectedBooking(null)} />}{canSubmitOwnTime && selectedBooking.personId === currentPersonId && <><ActualTimeDialog booking={selectedBooking} /><BookingConflictFlagDialog bookingId={selectedBooking.id} title={selectedBooking.title} /></>}<Button size="sm" variant="tertiary" onPress={() => setSelectedBooking(null)}>Close</Button></div>}
    <ScheduleWorkOrderDialog key={pendingReservation ? `${pendingReservation.workOrder.id}-${pendingReservation.roomId}-${pendingReservation.startsAt.toISOString()}` : "no-reservation"} workOrder={pendingReservation?.workOrder ?? null} rooms={rooms} initialRoomId={pendingReservation?.roomId ?? null} initialStart={pendingReservation?.startsAt ?? null} onClose={() => setPendingReservation(null)} />
  </div>;
}

function StaffDayView({ people, bookings, cateringRequests, day, onSelect }: { people: BookingResources["people"]; bookings: ScheduleBooking[]; cateringRequests: CateringRequest[]; day: Date; onSelect: (booking: ScheduleBooking) => void }) {
  const dayEnd = addDays(day, 1);
  const rows = people.map((person) => {
    const next = bookings.filter((booking) => booking.personId === person.id && overlaps(operationalStart(booking), operationalEnd(booking), day, dayEnd)).sort((a, b) => operationalStart(a).getTime() - operationalStart(b).getTime())[0];
    const catering = next ? cateringRequests.filter((request) => request.bookingId === next.id || request.requestedByPersonId === person.id).filter((request) => request.requestedFor && overlaps(request.requestedFor, new Date(request.requestedFor.getTime() + 1), day, dayEnd)).sort((a, b) => (a.requestedFor?.getTime() ?? 0) - (b.requestedFor?.getTime() ?? 0))[0] : undefined;
    return { person, next, catering };
  });
  return <section className="panel operational-register overflow-x-auto"><div className="min-w-[820px]"><div className="operational-register__header grid grid-cols-[1.2fr_1.5fr_130px_1.1fr_100px_1.4fr_1fr] gap-3 border-b border-[#ebeae6] bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e837f]"><span>Person</span><span>Next booking</span><span>Call / start</span><span>Room</span><span>Episode</span><span>Handover note</span><span>Catering</span></div><div className="divide-y divide-[#efeeea]">{rows.map(({ person, next, catering }) => <div key={person.id} className={`operational-register__row grid grid-cols-[1.2fr_1.5fr_130px_1.1fr_100px_1.4fr_1fr] items-center gap-3 px-5 py-3 text-xs ${availabilityState(person.availability, next) === "unavailable" ? "operational-register__row--attention" : ""}`}><div><div className="flex items-center gap-2"><p className="font-semibold text-[#46514c]">{person.name}{person.isFreelancer ? <span className="ml-1.5 font-normal text-[#7c827f]">Freelance</span> : null}</p><AvailabilityBadge state={availabilityState(person.availability, next)} /></div><p className="mt-0.5 capitalize text-[#858a87]">{person.role.replaceAll("_", " ")}</p></div>{next ? <><button type="button" onClick={() => onSelect(next)} className="truncate text-left font-medium text-[#476d63] hover:underline">{next.title}</button><span className="text-[#5e6964]">{timeLabel(operationalStart(next))} call · {timeLabel(next.startsAt)} start</span><span className="truncate text-[#5e6964]">{next.roomName ?? "No room"}</span><span className="font-medium text-[#5e6964]">{next.episodeProductionCode ?? "—"}</span><span className="line-clamp-2 text-[#777f7b]">{next.notes ?? (next.handoverMinutes ? `${next.handoverMinutes} min handover` : "—")}</span><span>{catering ? <span className="inline-flex items-center gap-1 rounded-full bg-[#edf1ee] px-2 py-1 text-[10px] font-semibold text-[#557269]"><Coffee size={11} /> {catering.status.replaceAll("_", " ")}</span> : <span className="text-[#969b98]">None</span>}</span></> : <><span className="col-span-6 text-[#969b98]">No booking scheduled</span></>}</div>)}</div></div></section>;
}

function GanttHeader({ days }: { days: Date[] }) {
  return <div className="grid border-b border-[#ebeae6]" style={{ gridTemplateColumns: `${ROOM_COLUMN_WIDTH}px minmax(0, 1fr)` }}>
    <div className="flex items-end bg-[#fafaf8] px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a8f8c]">Suite / room</div>
    <div className="grid" style={{ gridTemplateColumns: `repeat(${days.length}, ${DAY_WIDTH}px)` }}>
      {days.map((day) => <div key={day.toISOString()} className="gantt-day-header border-l border-[#ebeae6]"><div className="px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#718078]">{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day)}</p><p className="mt-0.5 text-sm font-semibold text-[#3c4440]">{new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(day)}</p></div><div className="grid border-t border-[#efeee9]" style={{ gridTemplateColumns: `repeat(${HOURS_PER_DAY}, 1fr)` }}>{Array.from({ length: HOURS_PER_DAY }, (_, index) => <span key={index} className={`gantt-hour-band border-r px-1 py-1 text-center text-[9px] ${index === 3 || index === 6 ? "gantt-hour-band--key" : ""}`}>{String(SUITE_DAY_START / 60 + index).padStart(2, "0")}</span>)}</div></div>)}
    </div>
  </div>;
}

function GanttTimeline({ rows, days, rangeStart, conflictingBookingIds, draggedWorkOrder, onDropWorkOrder, onSelect }: { rows: GanttRow[]; days: number; rangeStart: Date; conflictingBookingIds: Set<string>; draggedWorkOrder: SchedulableWorkOrder | null; onDropWorkOrder: (roomId: string, startsAt: Date) => void; onSelect: (booking: ScheduleBooking) => void }) {
  if (!rows.length) return <p className="px-4 py-6 text-xs text-[#9a9e9b]">No rooms or bookings in this period.</p>;
  return <div>{rows.map((row) => <GanttRoomRow key={row.id} row={row} days={days} rangeStart={rangeStart} conflictingBookingIds={conflictingBookingIds} canDrop={Boolean(draggedWorkOrder) && !["personnel-availability", "unassigned"].includes(row.id)} onDropWorkOrder={onDropWorkOrder} onSelect={onSelect} />)}</div>;
}

function GanttRoomRow({ row, days, rangeStart, conflictingBookingIds, canDrop, onDropWorkOrder, onSelect }: { row: GanttRow; days: number; rangeStart: Date; conflictingBookingIds: Set<string>; canDrop: boolean; onDropWorkOrder: (roomId: string, startsAt: Date) => void; onSelect: (booking: ScheduleBooking) => void }) {
  const rowHeight = Math.max(52, row.lanes * 48 + 8);
  const totalMinutes = days * MINUTES_IN_SUITE_DAY;
  return <div className="grid border-b border-[#ebeae6]" style={{ gridTemplateColumns: `${ROOM_COLUMN_WIDTH}px minmax(0, 1fr)`, minHeight: `${rowHeight}px` }}>
    <div className="gantt-room-label flex flex-col justify-center border-r border-[#ebeae6] px-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold text-[#4b5550]">{row.name}</p><span className="text-[10px] font-semibold text-[#7a8580]">{row.bookings.length}</span></div><p className="mt-0.5 truncate text-[10px] capitalize text-[#7d8782]">{row.type.replaceAll("_", " ")}</p></div>
    <div data-testid={`room-timeline-${row.id}`} className={`relative bg-[#fafbf9] ${canDrop ? "ring-inset ring-1 ring-[#b6cfbd]" : ""}`} style={{ minHeight: `${rowHeight}px` }} onDragOver={(event) => { if (canDrop) event.preventDefault(); }} onDrop={(event) => { if (!canDrop) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); const minute = Math.max(0, Math.min(days * MINUTES_IN_SUITE_DAY - 15, Math.floor(((event.clientX - bounds.left) / bounds.width * days * MINUTES_IN_SUITE_DAY) / 15) * 15)); const day = Math.floor(minute / MINUTES_IN_SUITE_DAY); const startsAt = addDays(rangeStart, day); startsAt.setHours(0, SUITE_DAY_START + minute % MINUTES_IN_SUITE_DAY, 0, 0); onDropWorkOrder(row.id, startsAt); }}>
      <TimelineGrid days={days} />
      {row.bookings.map((placement) => <GanttBookingBar key={placement.booking.id} placement={placement} totalMinutes={totalMinutes} hasConflict={conflictingBookingIds.has(placement.booking.id)} onSelect={onSelect} />)}
      {!row.bookings.length && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-[#a2a6a2]">{canDrop ? "Drop work order to reserve" : "Available"}</span>}
    </div>
  </div>;
}

function TimelineGrid({ days }: { days: number }) {
  return <><div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days * HOURS_PER_DAY}, 1fr)` }}>{Array.from({ length: days * HOURS_PER_DAY }, (_, index) => <div key={index} className="border-r border-[#efeee9]" />)}</div><div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, 1fr)` }}>{Array.from({ length: days }, (_, index) => <div key={index} className="border-r border-[#dddeda] last:border-r-0" />)}</div></>;
}

function BookingLegend() {
  return <div className="booking-legend flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[10px] text-[#68736d]" aria-label="Booking legend">
    <span><i className="booking-legend__swatch booking-legend__swatch--confirmed" />Confirmed</span>
    <span><i className="booking-legend__swatch booking-legend__swatch--hold" />Pencil hold</span>
    <span><i className="booking-legend__swatch booking-legend__swatch--reservation" />Work reservation</span>
    <span><i className="booking-legend__swatch booking-legend__swatch--conflict" />Conflict</span>
    <span className="text-[#89918d]">Colour identifies booking department.</span>
  </div>;
}

function availabilityState(availability: string, booking: ScheduleBooking | undefined) {
  if (availability !== "available") return "unavailable";
  if (booking && (booking.approvedOvertimeMinutes > 0 || (booking.actualEndsAt && booking.actualEndsAt > booking.endsAt))) return "overtime";
  return booking ? "booked" : "free";
}

function AvailabilityBadge({ state }: { state: "free" | "booked" | "unavailable" | "overtime" }) {
  const label = state === "free" ? "Free" : state === "booked" ? "Booked" : state === "overtime" ? "Overtime" : "Unavailable";
  return <span className={`availability-badge availability-badge--${state}`}>{label}</span>;
}

function bookingVisualState(booking: ScheduleBooking, hasConflict: boolean) {
  if (booking.status === "cancelled") return "cancelled";
  // A red bar is reserved for a live overlap of blocking resources; it is
  // derived from the calendar windows, not from a label or the booking title.
  if (hasConflict) return "conflict";
  if (booking.isOption) return "hold";
  // Work-order reservations are identified by their real linked record.
  if (booking.workOrderId) return "reservation";
  if (booking.status === "confirmed") return "confirmed";
  return "tentative";
}

function bookingStateLabel(state: string) { return state === "hold" ? "Pencil hold" : state === "reservation" ? "Work reservation" : state === "conflict" ? "Conflict" : state === "tentative" ? "Tentative" : state === "cancelled" ? "Cancelled" : "Confirmed"; }

function GanttBookingBar({ placement, totalMinutes, hasConflict, onSelect }: { placement: GanttBooking; totalMinutes: number; hasConflict: boolean; onSelect: (booking: ScheduleBooking) => void }) {
  const { booking } = placement;
  const optionLabel = booking.isOption ? `Pencil ${booking.optionRank ?? "—"} · ` : "";
  const state = bookingVisualState(booking, hasConflict);
  return <button data-testid={`booking-bar-${booking.id}`} data-booking-state={state} type="button" onClick={() => onSelect(booking)} aria-label={`Edit ${optionLabel}${booking.title}`} title={`${bookingStateLabel(state)}. ${booking.isOption ? `${optionLabel}provisional hold. ` : ""}Client: ${timeLabel(booking.startsAt)}–${timeLabel(booking.endsAt)}. Operational: ${timeLabel(operationalStart(booking))}–${timeLabel(operationalEnd(booking))}.${booking.workflowState ? ` Episode workflow: ${booking.workflowState.primaryStageName ?? "not started"} (${booking.workflowState.displayStatus.replaceAll("_", " ")}).` : ""}`} style={{ top: `${placement.lane * 48 + 4}px`, left: `calc(${(placement.start / totalMinutes) * 100}% + 3px)`, width: `calc(${Math.max(1.5, ((placement.end - placement.start) / totalMinutes) * 100)}% - 6px)` }} className={`gantt-booking gantt-booking--${state} gantt-booking--${booking.bookingType} absolute ${state === "hold" ? "h-7 border-dashed py-1" : "h-10 py-1.5"} overflow-hidden rounded-md border-l-[3px] px-2 text-left shadow-sm transition-shadow hover:z-10 hover:shadow-md focus:z-10 focus:outline-none focus:ring-2 focus:ring-[#66877f]`}><p className="truncate text-[11px] font-semibold text-[#414945]"><span className="mr-1 text-[9px] font-bold uppercase tracking-[.06em] text-[#6d7771]">{bookingStateLabel(state)}</span>{optionLabel}{booking.title}</p>{state !== "hold" && <p className="mt-0.5 truncate text-[10px] text-[#68716d]">{booking.actualStartsAt ? `Actual ${timeLabel(booking.actualStartsAt)}–${timeLabel(booking.actualEndsAt ? booking.actualEndsAt : booking.endsAt)}` : `Client ${timeLabel(booking.startsAt)}–${timeLabel(booking.endsAt)}`} · {booking.workflowState?.primaryStageName ?? booking.personName ?? "Unassigned"}</p>}</button>;
}

/**
 * The calendar's red state is calculated from the same operational windows
 * used to position the bars: planned/actual time plus setup and handover.
 * Options are deliberately excluded because pencil holds may overlap.
 */
function bookingConflictIds(bookings: ScheduleBooking[]) {
  const active = bookings.filter((booking) => booking.status !== "cancelled" && !booking.isOption);
  const conflicting = new Set<string>();
  for (let index = 0; index < active.length; index += 1) {
    for (let comparisonIndex = index + 1; comparisonIndex < active.length; comparisonIndex += 1) {
      const left = active[index]; const right = active[comparisonIndex];
      const sharesRoom = Boolean(left.roomId && left.roomId === right.roomId);
      const sharesPerson = Boolean(left.personId && left.personId === right.personId);
      if ((sharesRoom || sharesPerson) && operationalStart(left) < operationalEnd(right) && operationalEnd(left) > operationalStart(right)) {
        conflicting.add(left.id); conflicting.add(right.id);
      }
    }
  }
  return conflicting;
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
function isPersonnelAvailabilityBooking(type: string) { return ["leave", "training", "sick", "unavailable"].includes(type); }
function startOfDay(date: Date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function suiteDayStart(date: Date) { const value = startOfDay(date); value.setHours(SUITE_DAY_START / 60, 0, 0, 0); return value; }
function addDays(date: Date, count: number) { const value = new Date(date); value.setDate(value.getDate() + count); return value; }
function overlaps(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) { return start < rangeEnd && end > rangeStart; }
/** Confirmed actuals are the calendar's visual source of truth once recorded. */
function operationalStart(booking: ScheduleBooking) { return new Date((booking.actualStartsAt ?? booking.startsAt).getTime() - booking.setupMinutes * 60_000); }
function operationalEnd(booking: ScheduleBooking) { return new Date((booking.actualEndsAt ?? booking.endsAt).getTime() + booking.handoverMinutes * 60_000); }
function calendarDayDistance(rangeStart: Date, value: Date) { return Math.floor((startOfDay(value).getTime() - rangeStart.getTime()) / 86_400_000); }
function minutesOfDay(date: Date) { return date.getHours() * 60 + date.getMinutes(); }
function timeLabel(date: Date) { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function toInput(date: Date) { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function rangeLabel(days: Date[]) { if (days.length === 1) return new Intl.DateTimeFormat("en-GB", { weekday: "long", month: "long", day: "numeric" }).format(days[0]); return `${new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(days[0])} – ${new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(days.at(-1)!)} `; }
