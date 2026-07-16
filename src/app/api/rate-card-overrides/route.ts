import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { episodes, rateCardItems, rateCards, seasons, serviceRates, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const bodySchema = z.object({
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("master") }),
    z.object({ type: z.literal("network"), network: z.string().trim().min(1).max(160) }),
    z.object({ type: z.literal("show"), showId: z.string().uuid() }),
    z.object({ type: z.literal("episode"), episodeId: z.string().uuid() }),
  ]),
  serviceRateId: z.string().uuid(),
  rate: z.coerce.number().positive(),
});

export async function POST(request: Request) {
  if (!(await can("manage_rates"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid rate and override amount." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { organizationId } = context.organization;
  const db = getDb();
  const [service] = await db.select().from(serviceRates).where(and(eq(serviceRates.id, parsed.data.serviceRateId), eq(serviceRates.organizationId, organizationId))).limit(1);
  if (!service) return NextResponse.json({ error: "Service rate not found." }, { status: 404 });

  const scope = parsed.data.scope;
  if (scope.type === "show") {
    const [show] = await db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, scope.showId), eq(shows.organizationId, organizationId))).limit(1);
    if (!show) return NextResponse.json({ error: "Show not found." }, { status: 404 });
  }
  if (scope.type === "episode") {
    const [episode] = await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, scope.episodeId), eq(episodes.organizationId, organizationId))).limit(1);
    if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  }

  const filters = scope.type === "master"
    ? and(isNull(rateCards.clientCompanyId), isNull(rateCards.network), isNull(rateCards.showId), isNull(rateCards.episodeId))
    : scope.type === "network" ? eq(rateCards.network, scope.network) : scope.type === "show" ? eq(rateCards.showId, scope.showId) : eq(rateCards.episodeId, scope.episodeId);
  let [card] = await db.select().from(rateCards).where(and(eq(rateCards.organizationId, organizationId), filters)).limit(1);
  if (!card) {
    const target = scope.type === "master" ? { name: "Master rate card" } : scope.type === "network" ? { network: scope.network, name: `${scope.network} network rate card` } : scope.type === "show" ? { showId: scope.showId, name: "Show rate card" } : { episodeId: scope.episodeId, name: "Episode rate card" };
    [card] = await db.insert(rateCards).values({ organizationId, currency: service.currency, ...target }).returning();
  }
  await db.insert(rateCardItems).values({ organizationId, rateCardId: card.id, serviceRateId: service.id, category: service.category, unit: service.unit, rate: String(parsed.data.rate) }).onConflictDoUpdate({ target: [rateCardItems.rateCardId, rateCardItems.category, rateCardItems.unit], set: { rate: String(parsed.data.rate), serviceRateId: service.id, updatedAt: new Date() } });
  return NextResponse.json({ ok: true, cardId: card.id });
}

export async function GET(request: Request) {
  if (!(await can("manage_rates"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const target = type === "network" ? url.searchParams.get("network") : type === "show" ? url.searchParams.get("showId") : type === "episode" ? url.searchParams.get("episodeId") : null;
  if (type !== "master" && !target) return NextResponse.json({ error: "Invalid rate-card scope." }, { status: 400 });
  const scopeFilter = type === "master"
    ? and(isNull(rateCards.clientCompanyId), isNull(rateCards.network), isNull(rateCards.showId), isNull(rateCards.episodeId))
    : type === "network" && target ? eq(rateCards.network, target) : type === "show" && target ? eq(rateCards.showId, target) : type === "episode" && target ? eq(rateCards.episodeId, target) : null;
  if (!scopeFilter) return NextResponse.json({ error: "Invalid rate-card scope." }, { status: 400 });
  const db = getDb();
  let showId: string | null = null; let network: string | null = null; let clientCompanyId: string | null = null;
  if (type === "show" && target) {
    const [show] = await db.select({ id: shows.id, network: shows.network, clientCompanyId: shows.clientCompanyId }).from(shows).where(and(eq(shows.id, target), eq(shows.organizationId, context.organization.organizationId))).limit(1);
    if (!show) return NextResponse.json({ error: "Show not found." }, { status: 404 });
    showId = show.id; network = show.network; clientCompanyId = show.clientCompanyId;
  } else if (type === "episode" && target) {
    const [episode] = await db.select({ showId: shows.id, network: shows.network, clientCompanyId: shows.clientCompanyId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, target), eq(episodes.organizationId, context.organization.organizationId))).limit(1);
    if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
    showId = episode.showId; network = episode.network; clientCompanyId = episode.clientCompanyId;
  } else if (type === "network") network = target;
  const cards = await db.select({ id: rateCards.id, currency: rateCards.currency, network: rateCards.network, showId: rateCards.showId, episodeId: rateCards.episodeId, clientCompanyId: rateCards.clientCompanyId }).from(rateCards).where(and(eq(rateCards.organizationId, context.organization.organizationId), eq(rateCards.isActive, true)));
  const masterCards = cards.filter((card) => !card.clientCompanyId && !card.network && !card.showId && !card.episodeId);
  const own = cards.filter((card) => type === "master" ? masterCards.includes(card) : type === "network" ? card.network === target && !card.showId && !card.episodeId : type === "show" ? card.showId === target && !card.episodeId : card.episodeId === target);
  const chain = [own, ...(type === "episode" ? [cards.filter((card) => card.showId === showId && !card.episodeId)] : []), ...((network ? [cards.filter((card) => card.network === network && !card.showId && !card.episodeId)] : [])), ...((clientCompanyId ? [cards.filter((card) => card.clientCompanyId === clientCompanyId && !card.network && !card.showId && !card.episodeId)] : [])), ...(type === "master" ? [] : [masterCards])].flat();
  const items = await db.select({ rateCardId: rateCardItems.rateCardId, category: rateCardItems.category, unit: rateCardItems.unit, rate: rateCardItems.rate }).from(rateCardItems).where(eq(rateCardItems.organizationId, context.organization.organizationId));
  const byCard = new Map(cards.map((card) => [card.id, card]));
  const effective: Record<string, { rate: string; currency: string; source: string }> = {};
  for (const card of chain) for (const item of items.filter((entry) => entry.rateCardId === card.id)) { const key = `${item.category}:${item.unit}`; if (!effective[key]) effective[key] = { rate: item.rate, currency: byCard.get(card.id)?.currency ?? "USD", source: card.id }; }
  const ownIds = new Set(own.map((card) => card.id));
  const overrides = Object.fromEntries(Object.entries(effective).filter(([, value]) => ownIds.has(value.source)).map(([key, value]) => [key, { rate: value.rate, currency: value.currency }]));
  return NextResponse.json({ overrides, inherited: effective });
}
