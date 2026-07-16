import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { episodes, rateCardItems, rateCards, seasons, serviceRates, shows } from "@/lib/db/schema";

/** Resolves pricing without mutating history: episode → show → network/client → master → base service rate. */
export async function resolveRate(organizationId: string, episodeId: string, category: string, unit: string) {
  const db = getDb();
  const [episode] = await db.select({ showId: shows.id, clientCompanyId: shows.clientCompanyId, network: shows.network }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
  if (!episode) return null;
  const cards = await db.select({ id: rateCards.id, name: rateCards.name, currency: rateCards.currency, network: rateCards.network, showId: rateCards.showId, episodeId: rateCards.episodeId, clientCompanyId: rateCards.clientCompanyId }).from(rateCards).where(and(eq(rateCards.organizationId, organizationId), eq(rateCards.isActive, true)));
  const ordered = [
    ...cards.filter((card) => card.episodeId === episodeId).map((card) => ({ card, source: "episode_rate_card" })),
    ...cards.filter((card) => card.showId === episode.showId && !card.episodeId).map((card) => ({ card, source: "show_rate_card" })),
    ...cards.filter((card) => card.network === episode.network && !card.showId && !card.episodeId).map((card) => ({ card, source: "network_rate_card" })),
    ...cards.filter((card) => card.clientCompanyId === episode.clientCompanyId && !card.showId && !card.episodeId && !card.network).map((card) => ({ card, source: "client_rate_card" })),
    ...cards.filter((card) => !card.clientCompanyId && !card.network && !card.showId && !card.episodeId).map((card) => ({ card, source: "master_rate_card" })),
  ];
  for (const { card, source } of ordered) { const [item] = await db.select().from(rateCardItems).where(and(eq(rateCardItems.organizationId, organizationId), eq(rateCardItems.rateCardId, card.id), eq(rateCardItems.category, category), eq(rateCardItems.unit, unit))).limit(1); if (item) return { rate: item.rate, currency: card.currency, source, cardId: card.id, itemId: item.id }; }
  const [facility] = await db.select().from(serviceRates).where(and(eq(serviceRates.organizationId, organizationId), eq(serviceRates.category, category), eq(serviceRates.unit, unit), eq(serviceRates.isActive, true))).limit(1);
  return facility ? { rate: facility.rate, currency: facility.currency, source: "facility_rate_card", cardId: null, itemId: facility.id } : null;
}
