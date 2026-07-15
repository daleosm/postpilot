"use client";

import { Button } from "@heroui/react";
import { CheckCircle2, Clock3, Timer } from "lucide-react";
import type { ReactNode } from "react";

import { ActualTimeDialog } from "@/components/actual-time-dialog";

export type MyTimeBooking = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  actualStartsAt: Date | null;
  actualEndsAt: Date | null;
  approvedOvertimeMinutes: number;
  roomName: string | null;
  episodeTitle: string | null;
  episodeProductionCode: string | null;
  timeStatus: "ready" | "confirmed";
};

export function MyTimeBoard({ bookings }: { bookings: MyTimeBooking[] }) {
  const ready = bookings.filter((booking) => booking.timeStatus === "ready").length;
  const confirmed = bookings.filter((booking) => booking.timeStatus === "confirmed").length;

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-2">
      <TimeMetric icon={<Timer size={16} />} label="To confirm" value={ready} tone="neutral" />
      <TimeMetric icon={<CheckCircle2 size={16} />} label="Confirmed actuals" value={confirmed} tone="confirmed" />
    </section>

    <section className="panel overflow-hidden">
      <div className="border-b border-[#ebeae6] px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-[#343c38]">My assigned bookings</h2>
        <p className="mt-1 text-xs text-[#858a87]">The last 60 days and next 30 days. Submit actual time only for work assigned to you.</p>
      </div>
      {bookings.length ? <div className="divide-y divide-[#efeeea]">{bookings.map((booking) => <article key={booking.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-[#46514c]">{booking.title}</p>
            <TimeStatus status={booking.timeStatus} />
          </div>
          <p className="mt-1 text-xs text-[#737c78]">{formatDateTime(booking.startsAt)}–{timeLabel(booking.endsAt)} · {booking.roomName ?? "No room"}</p>
          <p className="mt-1 text-xs text-[#858a87]">{booking.episodeProductionCode ?? "Unlinked work"}{booking.episodeTitle ? ` · ${booking.episodeTitle}` : ""}{booking.timeStatus === "confirmed" && booking.actualStartsAt ? ` · Actual ${formatDateTime(booking.actualStartsAt)}–${timeLabel(booking.actualEndsAt)}` : ""}</p>
        </div>
        <div className="shrink-0">{booking.timeStatus === "ready" ? <ActualTimeDialog booking={booking} /> : <Button size="sm" variant="tertiary" isDisabled className="border border-[#dbe8de] bg-[#f0f7f1] text-[#4d8068]">Confirmed</Button>}</div>
      </article>)}</div> : <div className="px-5 py-14 text-center"><Clock3 className="mx-auto text-[#a0a6a1]" size={23} /><p className="mt-3 text-sm font-medium text-[#59615d]">No assigned bookings in this period</p><p className="mt-1 text-xs text-[#858a87]">When production assigns you to a booking, it will appear here for time confirmation.</p></div>}
    </section>
  </div>;
}

function TimeMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "neutral" | "confirmed" }) {
  const tones = { neutral: "bg-[#eef1ee] text-[#61726b]", confirmed: "bg-[#e9f2eb] text-[#4f8068]" };
  return <div className="panel flex items-center gap-3 p-4"><span className={`flex h-8 w-8 items-center justify-center rounded-md ${tones[tone]}`}>{icon}</span><div><p className="text-xl font-semibold tracking-[-0.04em] text-[#37413d]">{value}</p><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#858a87]">{label}</p></div></div>;
}

function TimeStatus({ status }: { status: MyTimeBooking["timeStatus"] }) {
  const labels = { ready: "To confirm", confirmed: "Confirmed" };
  const tones = { ready: "bg-[#eef1ee] text-[#61726b]", confirmed: "bg-[#e9f2eb] text-[#4f8068]" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[status]}`}>{labels[status]}</span>;
}

function formatDateTime(value: Date | null) { return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—"; }
function timeLabel(value: Date | null) { return value ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—"; }
