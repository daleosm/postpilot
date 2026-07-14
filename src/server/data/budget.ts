import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bookings, billables, budgetLines, episodes, people, postWorkOrders, rooms, seasons, serviceRates, shows } from "@/lib/db/schema";
import { resolveRate } from "@/lib/rate-resolution";

export async function getBudgetData(organizationId: string) {
  const db = getDb();
  const [storedLines, invoices, workOrderCharges] = await Promise.all([
    db.select({
      id: budgetLines.id,
      category: budgetLines.category,
      description: budgetLines.description,
      budgetedAmount: budgetLines.budgetedAmount,
      actualAmount: budgetLines.actualAmount,
      currency: budgetLines.currency,
      costType: budgetLines.costType,
      showId: shows.id,
      showTitle: shows.title,
      network: shows.network,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      episodeNumber: episodes.number,
    })
      .from(budgetLines)
      .leftJoin(episodes, eq(budgetLines.episodeId, episodes.id))
      .leftJoin(seasons, eq(episodes.seasonId, seasons.id))
      .leftJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(budgetLines.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))),
    db.select().from(billables).where(eq(billables.organizationId, organizationId)).orderBy(desc(billables.invoiceDate)),
    db.select({
      id: postWorkOrders.id, title: postWorkOrders.title, department: postWorkOrders.department, status: postWorkOrders.status,
      billingStatus: postWorkOrders.billingStatus, estimatedAmount: sql<string | null>`coalesce(${postWorkOrders.clientQuoteAmount}, ${postWorkOrders.estimatedAmount})`, actualAmount: postWorkOrders.actualAmount,
      currency: sql<string>`coalesce(${postWorkOrders.clientQuoteCurrency}, ${postWorkOrders.currency})`, billingNotes: postWorkOrders.billingNotes, episodeId: episodes.id, episodeTitle: episodes.title,
      episodeNumber: episodes.number, showTitle: shows.title,
    }).from(postWorkOrders)
      .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.billingScope, "billable_change"), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)))
      .orderBy(asc(postWorkOrders.createdAt)),
  ]);
  const bookingCosts = await listBookingCosts(organizationId);
  const lines = applyBookingCostRollups(storedLines, bookingCosts);
  return {
    lines,
    billables: invoices,
    workOrderCharges,
    totals: lines.reduce((total, line) => ({ budgeted: total.budgeted + Number(line.budgetedAmount), actual: total.actual + Number(line.actualAmount) }), { budgeted: 0, actual: 0 }),
  };
}

export async function listServiceRates(organizationId: string) {
  const db = getDb();
  return db.select({ id: serviceRates.id, name: serviceRates.name, category: serviceRates.category, unit: serviceRates.unit, rate: serviceRates.rate, currency: serviceRates.currency, notes: serviceRates.notes, isActive: serviceRates.isActive })
    .from(serviceRates).where(eq(serviceRates.organizationId, organizationId)).orderBy(desc(serviceRates.isActive), serviceRates.name);
}

const bookingRateCategory: Partial<Record<string, { category: string; unit: "hour" | "day" | "episode" | "fixed" }>> = {
  edit: { category: "Edit suite", unit: "day" },
  color: { category: "Colour", unit: "day" },
  mix: { category: "Sound", unit: "day" },
  qc: { category: "QC", unit: "episode" },
};

/**
 * A live room-and-artist cost basis. Planned and approved actual time are the
 * source of truth for booking-derived budget categories.
 */
export async function listEpisodeBookingCosts(organizationId: string, episodeId: string) {
  return listBookingCosts(organizationId, episodeId);
}

export async function getBookingCostApprovalProjection(organizationId: string, episodeId: string, actualOverride: { bookingId: string; actualStartsAt: Date; actualEndsAt: Date; overtimeMinutes: number }) {
  const costs = await listBookingCosts(organizationId, episodeId, actualOverride);
  const changed = costs.find((cost) => cost.id === actualOverride.bookingId);
  if (!changed?.category) return null;
  const categoryCosts = costs.filter((cost) => cost.category === changed.category && cost.plannedCost !== null);
  if (!categoryCosts.length) return null;
  return {
    category: changed.category,
    currency: changed.currency,
    budgetedAmount: categoryCosts.reduce((sum, cost) => sum + (cost.plannedCost ?? 0), 0),
    actualAmount: categoryCosts.reduce((sum, cost) => sum + (cost.actualCost ?? 0), 0),
    bookingCount: categoryCosts.length,
  };
}

async function listBookingCosts(organizationId: string, episodeId?: string, actualOverride?: { bookingId: string; actualStartsAt: Date; actualEndsAt: Date; overtimeMinutes: number }) {
  const db = getDb();
  const bookingRows = await db.select({
      id: bookings.id,
      episodeId: bookings.episodeId,
      bookingType: bookings.bookingType,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      actualStartsAt: bookings.actualStartsAt,
      actualEndsAt: bookings.actualEndsAt,
      approvedOvertimeMinutes: bookings.approvedOvertimeMinutes,
      roomName: rooms.name,
      personName: people.name,
    }).from(bookings)
      .leftJoin(rooms, and(eq(bookings.roomId, rooms.id), eq(rooms.organizationId, organizationId)))
      .leftJoin(people, and(eq(bookings.personId, people.id), eq(people.organizationId, organizationId)))
      .where(and(eq(bookings.organizationId, organizationId), episodeId ? eq(bookings.episodeId, episodeId) : undefined))
      .orderBy(asc(bookings.startsAt));

  return Promise.all(bookingRows.filter((booking) => booking.status !== "cancelled" && booking.episodeId).map(async (booking) => {
    const definition = bookingRateCategory[booking.bookingType];
    const resolved = definition ? await resolveRate(organizationId, booking.episodeId!, definition.category, definition.unit) : null;
    const plannedHours = facilityHours(booking.startsAt, booking.endsAt);
    const submittedActual = booking.id === actualOverride?.bookingId ? actualOverride : null;
    const actualStartsAt = submittedActual?.actualStartsAt ?? booking.actualStartsAt;
    const actualEndsAt = submittedActual?.actualEndsAt ?? booking.actualEndsAt;
    const approvedOvertimeMinutes = submittedActual?.overtimeMinutes ?? booking.approvedOvertimeMinutes;
    const actualHours = actualStartsAt && actualEndsAt ? facilityHours(actualStartsAt, actualEndsAt) + approvedOvertimeMinutes / 60 : null;
    const plannedCost = resolved ? costForHours(Number(resolved.rate), definition!.unit, plannedHours) : null;
    const actualCost = resolved && actualHours !== null ? costForHours(Number(resolved.rate), definition!.unit, actualHours) : null;
    return {
      id: booking.id,
      episodeId: booking.episodeId!,
      category: definition?.category ?? null,
      roomName: booking.roomName ?? "No room assigned",
      artistName: booking.personName ?? "Unassigned",
      bookingType: booking.bookingType,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      plannedHours,
      actualHours,
      approvedOvertimeMinutes,
      rate: resolved ? Number(resolved.rate) : null,
      rateUnit: definition?.unit ?? null,
      rateSource: resolved?.source ?? null,
      currency: resolved?.currency ?? null,
      plannedCost,
      actualCost,
      variance: actualCost !== null && plannedCost !== null ? actualCost - plannedCost : null,
    };
  }));
}

function applyBookingCostRollups<T extends { episodeId: string | null; category: string; budgetedAmount: string | number; actualAmount: string | number }>(lines: T[], bookingCosts: Awaited<ReturnType<typeof listBookingCosts>>) {
  const rollups = new Map<string, { planned: number; actual: number }>();
  for (const booking of bookingCosts) {
    if (!booking.category || booking.plannedCost === null) continue;
    const key = `${booking.episodeId}:${booking.category}`;
    const rollup = rollups.get(key) ?? { planned: 0, actual: 0 };
    rollup.planned += booking.plannedCost;
    rollup.actual += booking.actualCost ?? 0;
    rollups.set(key, rollup);
  }
  return lines.map((line) => {
    const rollup = line.episodeId ? rollups.get(`${line.episodeId}:${line.category}`) : undefined;
    return rollup ? { ...line, budgetedAmount: rollup.planned, actualAmount: rollup.actual } : line;
  });
}

function facilityHours(startsAt: Date, endsAt: Date) {
  const sameDay = startsAt.getFullYear() === endsAt.getFullYear() && startsAt.getMonth() === endsAt.getMonth() && startsAt.getDate() === endsAt.getDate();
  if (sameDay) return Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3_600_000);

  const firstDayEnd = new Date(startsAt);
  firstDayEnd.setHours(18, 0, 0, 0);
  const lastDayStart = new Date(endsAt);
  lastDayStart.setHours(9, 0, 0, 0);
  let hours = Math.max(0, (firstDayEnd.getTime() - startsAt.getTime()) / 3_600_000) + Math.max(0, (endsAt.getTime() - lastDayStart.getTime()) / 3_600_000);
  const cursor = new Date(startsAt);
  cursor.setHours(9, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor < lastDayStart) {
    hours += 9;
    cursor.setDate(cursor.getDate() + 1);
  }
  return hours;
}

/** The facility schedule uses a 9-hour client day (09:00–18:00). */
function costForHours(rate: number, unit: "hour" | "day" | "episode" | "fixed", hours: number) {
  if (unit === "hour") return rate * hours;
  if (unit === "day") return rate * (hours / 9);
  return rate;
}
