import { ArrowRight, CircleDollarSign, ReceiptText, TrendingUp } from "lucide-react";
import Link from "next/link";

import { EstimateBuilder } from "@/components/estimate-builder";
import { EstimateRevisionPanel, type EstimateOverview } from "@/components/estimate-revision-panel";
import { EpisodeBudgetOperations, type OperationalLedger } from "@/components/episode-budget-operations";
import type { ClientPurchaseOrderSummary } from "@/components/client-purchase-orders-summary";
import { EpisodeInvoicePanel } from "@/components/episode-invoice-panel";
import { PageHeader } from "@/components/operations-ui";
import { RateCardDialog } from "@/components/rate-card-dialog";
import type { ServiceRate } from "@/components/service-rate-card";
import { WorkOrderChargeQueue } from "@/components/work-order-charge-queue";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import type { FrontendVendorPurchaseOrder as PurchaseOrderSummary } from "@/lib/postpilot-api-commercial";
import { redirect } from "next/navigation";

type Line = {
  id: string;
  workOrderId: string | null;
  vendorInvoiceId: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  purchaseOrderAllocationId: string | null;
  externalCost: boolean;
  episodeId: string | null;
  episodeTitle: string | null;
  episodeNumber: number | null;
  category: string;
  description: string | null;
  showTitle: string | null;
  network: string | null;
  budgetedAmount: string | number;
  actualAmount: string | number;
  currency: string;
  costType: string;
  showId: string | null;
};

type BudgetData = {
  lines: Line[];
  episodes: Array<{ id: string; label: string; showId: string; showTitle: string; network: string }>;
  resources: { services: Array<{ id: string; name: string; category: string; unit: string }>; rooms: Array<{ id: string; name: string; type: string }>; people: Array<{ id: string; name: string; role: string }>; vendors: Array<{ id: string; name: string }> };
  workOrderCharges: Array<{ id: string; title: string; status: string; billingStatus: string; estimatedAmount: string | number | null; currency: string; billingNotes: string | null; episodeId: string; episodeTitle: string; episodeNumber: number; showId: string; showTitle: string; clientCompanyId: string | null }>;
  purchaseOrders: PurchaseOrderSummary[];
  clientPurchaseOrders: ClientPurchaseOrderSummary[];
};

type BookingCost = {
  id: string;
  episodeId: string;
  category: string | null;
  roomName: string;
  artistName: string;
  bookingType: string;
  startsAt: Date;
  endsAt: Date;
  plannedHours: number;
  actualHours: number | null;
  approvedOvertimeMinutes: number;
  rate: number | null;
  rateUnit: string | null;
  rateSource: string | null;
  currency: string | null;
  plannedCost: number | null;
  actualCost: number | null;
  variance: number | null;
};

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ network?: string; show?: string; episode?: string }> }) {
  if (!(await can("manage_budget"))) redirect("/");
  const params = await searchParams;
  const activeShow = params.show;
  const selectedNetwork = params.network;
  const data = await load();
  const serviceRates = await loadServiceRates();
  const selectedEpisodeId = params.episode;
  const networks = [...new Set([...data.lines.map((line) => line.network ?? "Independent"), ...data.episodes.map((episode) => episode.network)])];
  if (!selectedNetwork) return <BudgetNetworkPicker networks={networks} lines={data.lines} rates={serviceRates} />;
  const showRows = [...new Map([
    ...data.lines.filter((line) => (line.network ?? "Independent") === selectedNetwork && line.showId && line.showTitle).map((line) => [line.showId!, { id: line.showId!, title: line.showTitle! }] as const),
    ...data.episodes.filter((episode) => episode.network === selectedNetwork).map((episode) => [episode.showId, { id: episode.showId, title: episode.showTitle }] as const),
  ]).values()];
  const showNames = showRows.map((show) => show.title);
  if (!activeShow) return <BudgetShowPicker network={selectedNetwork} shows={showRows} lines={data.lines} rates={serviceRates} />;
  if (!showNames.includes(activeShow)) redirect(`/budget?network=${encodeURIComponent(selectedNetwork)}`);
  if (!selectedEpisodeId) return <BudgetEpisodePicker network={selectedNetwork} show={activeShow} episodes={data.episodes.filter((episode) => episode.showTitle === activeShow)} lines={data.lines.filter((line) => line.showTitle === activeShow)} rates={serviceRates} showId={showRows.find((show) => show.title === activeShow)?.id} purchaseOrders={data.purchaseOrders} />;
  const selectedEpisode = data.episodes.find((episode) => episode.id === selectedEpisodeId && episode.showTitle === activeShow);
  if (!selectedEpisode) redirect(`/budget?network=${encodeURIComponent(selectedNetwork)}&show=${encodeURIComponent(activeShow)}`);
  const [canApproveBillableCharges, canIssueInvoices] = await Promise.all([can("approve_booking_charges_for_billing"), can("issue_invoices")]);
  const [bookingCosts, invoiceReadiness, estimateOverview, operationalLedger] = await Promise.all([
    loadBookingCosts(selectedEpisodeId),
    canApproveBillableCharges ? loadInvoiceReadiness(selectedEpisodeId) : Promise.resolve(null),
    loadEstimateOverview(selectedEpisodeId),
    loadOperationalLedger(selectedEpisodeId),
  ]);
  const episodes = [selectedEpisode];
  const lines = data.lines.filter((line) => line.episodeId === selectedEpisodeId && line.showTitle === activeShow);
  const currency = estimateOverview.currency ?? lines[0]?.currency ?? "USD";
  const episodePurchaseOrders = purchaseOrdersForEpisode(data.purchaseOrders, selectedEpisode);
  const episodeClientPurchaseOrders = clientPurchaseOrdersForEpisode(data.clientPurchaseOrders, selectedEpisode);
  const episodeLabel = selectedEpisode.label.replace(`${activeShow} · `, "");

  return <div className="space-y-5">
    <PageHeader eyebrow={`Episode cost control · ${activeShow}`} title={`Budget · ${episodeLabel}`} description="Episode-level costs with show roll-ups for post-production control." action={<div className="flex gap-2"><Link href={`/budget?network=${encodeURIComponent(selectedNetwork)}&show=${encodeURIComponent(activeShow)}`} className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#52635d]">All episodes</Link>{!estimateOverview.isLocked && <EstimateBuilder episode={selectedEpisode} resources={data.resources} />}</div>} />

    <div className="flex justify-end"><RateCardDialog rates={serviceRates} scope={{ type: "episode", episodeId: selectedEpisodeId }} title="Episode service rate card" /></div>
    <EstimateRevisionPanel episodeId={selectedEpisodeId} estimate={estimateOverview} />
    <EpisodeBudgetOperations estimate={estimateOverview} lines={lines} ledger={operationalLedger} episodes={episodes} resources={data.resources} purchaseOrders={episodePurchaseOrders} />
    <ClientPoBudgetSafeguards orders={episodeClientPurchaseOrders} />
    <EpisodeInvoicePanel episodeId={selectedEpisodeId} readiness={invoiceReadiness} canApproveBillableCharges={canApproveBillableCharges} canIssueInvoices={canIssueInvoices} />
    <BookingCostBasis entries={bookingCosts} fallbackCurrency={currency} />
    <WorkOrderChargeQueue charges={activeShow ? data.workOrderCharges.filter((charge) => charge.showTitle === activeShow) : data.workOrderCharges} />
    <PurchaseOrderBudgetSummary title="Episode purchase orders" orders={episodePurchaseOrders} currency={currency} />

  </div>;
}

async function loadServiceRates() {
  const response = await postpilotApiServerFetch<{ service_rates: Array<{ id: string; name: string; category: string; artist_role: string | null; unit: string; rate: string | number; currency: string; notes: string | null; is_active: boolean }> }>("/rate-cards/services");
  return response.service_rates.map((rate) => ({ ...rate, artistRole: rate.artist_role, isActive: rate.is_active }));
}

async function loadBookingCosts(episodeId: string): Promise<BookingCost[]> {
  // Booking actuals and cost calculation live in FastAPI. The detailed cost
  // basis projection is being added alongside the time-submission ledger;
  // it deliberately has no second Node database read.
  void episodeId;
  return [];
}

async function loadInvoiceReadiness(episodeId: string) {
  return camelize(await postpilotApiServerFetch(`/billing/episodes/${episodeId}/readiness`)) as React.ComponentProps<typeof EpisodeInvoicePanel>["readiness"];
}

async function loadEstimateOverview(episodeId: string): Promise<EstimateOverview> {
  const response = await postpilotApiServerFetch<{ estimate: Record<string, unknown> }>(`/budget/episodes/${episodeId}/estimate-overview`);
  return camelize(response.estimate) as EstimateOverview;
}

async function loadOperationalLedger(episodeId: string): Promise<OperationalLedger> {
  const response = await postpilotApiServerFetch<{ ledger: Record<string, unknown> }>(`/budget/episodes/${episodeId}/operational-ledger`);
  return camelize(response.ledger) as OperationalLedger;
}

function Metric({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="panel p-4"><div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[.08em] ${warning ? "text-[#a65f42]" : "text-[#76807b]"}`}>{icon}{label}</div><p className="mt-3 text-xl font-semibold tracking-[-.035em] text-[#343d39]">{value}</p><p className="mt-1 text-xs text-[#858a87]">{detail}</p></div>;
}

function money(value: number, currency = "USD") {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; }
}

function BookingCostBasis({ entries, fallbackCurrency }: { entries: BookingCost[]; fallbackCurrency: string }) {
  return <section className="panel overflow-hidden">
    <div className="flex flex-col justify-between gap-2 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-end"><div><h2 className="text-sm font-semibold text-[#343b38]">Booked room and artist cost basis</h2><p className="mt-1 text-xs text-[#858a87]">Live booking dates, confirmed actuals, and inherited rates. Matching booking-derived cost lines roll up from this data automatically.</p></div><p className="text-xs font-medium text-[#718079]">9-hour facility day</p></div>
    {!entries.length ? <div className="px-5 py-12 text-center text-sm text-[#7d837f]">No active episode bookings yet. Create a room or artist booking to build its cost basis.</div> : <div className="overflow-x-auto"><div className="min-w-[1010px]">
      <div className="grid grid-cols-[minmax(175px,1.3fr)_145px_100px_130px_130px_130px] gap-3 bg-[#f5f5f1] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#747c77]"><span>Room / artist</span><span>Date</span><span>Hours</span><span>Rate</span><span>Planned cost</span><span>Actual / variance</span></div>
      <div className="divide-y divide-[#efeeea]">{entries.map((entry) => {
        const currency = entry.currency ?? fallbackCurrency;
        return <div key={entry.id} className="grid grid-cols-[minmax(175px,1.3fr)_145px_100px_130px_130px_130px] items-center gap-3 px-5 py-4 text-sm text-[#4f5753]">
          <div className="min-w-0"><p className="truncate font-semibold text-[#37413d]">{entry.roomName}</p><p className="mt-1 truncate text-xs text-[#858a87]">{entry.artistName} · {entry.bookingType.replaceAll("_", " ")}</p></div>
          <div className="text-xs text-[#59635e]"><p>{bookingDateRange(entry.startsAt, entry.endsAt)}</p><p className="mt-1 text-[#858a87]">{bookingTime(entry.startsAt)}–{bookingTime(entry.endsAt)}</p></div>
          <div className="text-xs"><p>{hours(entry.plannedHours)} planned</p><p className="mt-1 text-[#858a87]">{entry.actualHours === null ? "Actual pending" : `${hours(entry.actualHours)} actual`}{entry.approvedOvertimeMinutes ? " incl. confirmed OT" : ""}</p></div>
          <div className="text-xs">{entry.rate === null ? <span className="text-[#a65f42]">No rate configured</span> : <><p className="font-medium text-[#4d5752]">{money(entry.rate, currency)} / {entry.rateUnit}</p><p className="mt-1 text-[#858a87]">{rateSource(entry.rateSource)}</p></>}</div>
          <p className="text-xs font-medium text-[#4d5752]">{entry.plannedCost === null ? "—" : money(entry.plannedCost, currency)}</p>
          <div className="text-xs">{entry.actualCost === null ? <p className="text-[#858a87]">Awaiting actuals</p> : <><p className="font-medium text-[#4d5752]">{money(entry.actualCost, currency)}</p><p className={`mt-1 ${entry.variance && entry.variance > 0 ? "text-[#a65f42]" : "text-[#4f7767]"}`}>{entry.variance === null ? "—" : `${entry.variance > 0 ? "+" : ""}${money(entry.variance, currency)}`}</p></>}</div>
        </div>;
      })}</div>
    </div></div>}
  </section>;
}

function bookingDateRange(startsAt: Date, endsAt: Date) { const format = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" }); const start = format.format(startsAt); const end = format.format(endsAt); return start === end ? start : `${start}–${end}`; }
function bookingTime(date: Date) { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" }).format(date); }
function hours(value: number) { return `${Number.isInteger(value) ? value : value.toFixed(1)}h`; }
function rateSource(source: string | null) { return source === "episode_rate_card" ? "Episode rate card" : source === "show_rate_card" ? "Show rate card" : source === "network_rate_card" ? "Network rate card" : source === "client_rate_card" ? "Client rate card" : source === "master_rate_card" ? "Master rate card" : source === "facility_rate_card" ? "Base service rate" : ""; }

function BudgetNetworkPicker({ networks, lines, rates }: { networks: string[]; lines: Line[]; rates: ServiceRate[] }) {
  const totals = sumLines(lines);
  const currency = currencyFor(lines);
  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Commercial control</p>
      <h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Budget portfolio</h1>
      <p className="mt-1 text-sm text-[#747977]">Start with the master rate card, then review networks, shows and episodes.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/budget/purchase-orders" className="inline-flex items-center rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#52635d]">Vendor POs</Link><Link href="/budget/client-purchase-orders" className="inline-flex items-center rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#52635d]">Client POs</Link><RateCardDialog rates={rates} scope={{ type: "master" }} title="Master rate card" /></div>
    </header>
    <section className="grid gap-3 sm:grid-cols-3">
      <Metric icon={<CircleDollarSign size={16} />} label="Networks / clients" value={String(networks.length)} detail="With active budget lines" />
      <Metric icon={<ReceiptText size={16} />} label="Portfolio estimate" value={money(totals.estimate, currency)} detail={`${lines.length} cost lines`} />
      <Metric icon={<TrendingUp size={16} />} label="Portfolio actual" value={money(totals.actual, currency)} detail={`${burnLabel(totals.actual, totals.estimate)} of estimate`} warning={totals.actual > totals.estimate} />
    </section>
    <PortfolioTable>
      <div className="grid grid-cols-[minmax(230px,1.6fr)_88px_140px_140px_105px_34px] gap-3 bg-[#f5f5f1] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#747c77]">
        <span>Network / client</span><span>Shows</span><span>Estimate</span><span>Actual</span><span>Health</span><span aria-hidden />
      </div>
      <div className="divide-y divide-[#efeeea]">
        {networks.map((network) => {
          const networkLines = lines.filter((line) => (line.network ?? "Independent") === network);
          const totals = sumLines(networkLines);
          const currency = currencyFor(networkLines);
          const showCount = new Set(networkLines.map((line) => line.showId).filter(Boolean)).size;
          return <Link key={network} href={`/budget?network=${encodeURIComponent(network)}`} className="grid grid-cols-[minmax(230px,1.6fr)_88px_140px_140px_105px_34px] items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-[#f8faf7]">
            <div className="min-w-0"><p className="truncate font-semibold text-[#37413d]">{network}</p><p className="mt-1 truncate text-xs text-[#858a87]">View show budget exposure and negotiated service pricing.</p></div>
            <span className="text-[#5d6762]">{showCount}</span>
            <span className="font-medium text-[#4d5752]">{money(totals.estimate, currency)}</span>
            <span className="font-medium text-[#4d5752]">{money(totals.actual, currency)}</span>
            <BudgetHealth actual={totals.actual} estimate={totals.estimate} />
            <ArrowRight className="text-[#8b918d]" size={16} />
          </Link>;
        })}
      </div>
    </PortfolioTable>
  </div>;
}

function BudgetShowPicker({ network, shows, lines, rates }: { network: string; shows: Array<{ id: string; title: string }>; lines: Line[]; rates: ServiceRate[] }) {
  const networkLines = lines.filter((line) => (line.network ?? "Independent") === network);
  const totals = sumLines(networkLines);
  const currency = currencyFor(networkLines);
  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <Link href="/budget" className="text-xs font-semibold text-[#58756b]">← Budget portfolio</Link>
        <p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Network / client</p>
        <h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">{network}</h1>
        <p className="mt-1 text-sm text-[#747977]">Show-level cost exposure and inherited network rates.</p>
      </div>
      <RateCardDialog rates={rates} scope={{ type: "network", network }} title={`${network} rate card`} />
    </header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<CircleDollarSign size={16} />} label="Shows" value={String(shows.length)} detail="Budgeted productions" />
      <Metric icon={<ReceiptText size={16} />} label="Estimate" value={money(totals.estimate, currency)} detail={`${networkLines.length} cost lines`} />
      <Metric icon={<ReceiptText size={16} />} label="Actual" value={money(totals.actual, currency)} detail={`${burnLabel(totals.actual, totals.estimate)} of estimate`} />
      <Metric icon={<TrendingUp size={16} />} label="Forecast" value={money(totals.actual, currency)} detail="Actual recorded cost" warning={totals.actual > totals.estimate} />
    </section>
    <PortfolioTable>
      <div className="grid grid-cols-[minmax(220px,1.5fr)_82px_130px_130px_130px_96px_34px] gap-3 bg-[#f5f5f1] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#747c77]">
        <span>Show</span><span>Episodes</span><span>Estimate</span><span>Actual</span><span>Forecast</span><span>Health</span><span aria-hidden />
      </div>
      <div className="divide-y divide-[#efeeea]">
        {shows.map((show) => {
          const showLines = lines.filter((line) => line.showId === show.id);
          const totals = sumLines(showLines);
          const currency = currencyFor(showLines);
          const episodeCount = new Set(showLines.map((line) => line.episodeId).filter(Boolean)).size;
          const forecast = totals.actual;
          return <Link key={show.id} href={`/budget?network=${encodeURIComponent(network)}&show=${encodeURIComponent(show.title)}`} className="grid grid-cols-[minmax(220px,1.5fr)_82px_130px_130px_130px_96px_34px] items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-[#f8faf7]">
            <div className="min-w-0"><p className="truncate font-semibold text-[#37413d]">{show.title}</p><p className="mt-1 truncate text-xs text-[#858a87]">Open the episode budget ledger.</p></div>
            <span className="text-[#5d6762]">{episodeCount}</span>
            <span className="font-medium text-[#4d5752]">{money(totals.estimate, currency)}</span>
            <span className="font-medium text-[#4d5752]">{money(totals.actual, currency)}</span>
            <span className="font-medium text-[#4d5752]">{money(forecast, currency)}</span>
            <BudgetHealth actual={forecast} estimate={totals.estimate} />
            <ArrowRight className="text-[#8b918d]" size={16} />
          </Link>;
        })}
      </div>
    </PortfolioTable>
  </div>;
}

function BudgetEpisodePicker({ network, show, episodes, lines, rates, showId, purchaseOrders }: { network: string; show: string; episodes: Array<{ id: string; label: string; showTitle: string; showId: string }>; lines: Line[]; rates: ServiceRate[]; showId?: string; purchaseOrders: PurchaseOrderSummary[] }) {
  const totals = sumLines(lines);
  const currency = currencyFor(lines);
  const forecast = totals.actual;
  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <Link href={`/budget?network=${encodeURIComponent(network)}`} className="text-xs font-semibold text-[#58756b]">← {network}</Link>
        <p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Show budget</p>
        <h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">{show}</h1>
        <p className="mt-1 text-sm text-[#747977]">Episode-level cost control. Select an episode to manage its ledger and rate exceptions.</p>
      </div>
      {showId && <RateCardDialog rates={rates} scope={{ type: "show", showId }} title={`${show} rate card`} />}
    </header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<CircleDollarSign size={16} />} label="Episodes" value={String(episodes.length)} detail="With budget activity" />
      <Metric icon={<ReceiptText size={16} />} label="Estimate" value={money(totals.estimate, currency)} detail={`${lines.length} cost lines`} />
      <Metric icon={<ReceiptText size={16} />} label="Actual" value={money(totals.actual, currency)} detail={`${burnLabel(totals.actual, totals.estimate)} of estimate`} />
      <Metric icon={<TrendingUp size={16} />} label="Forecast" value={money(forecast, currency)} detail="Actual recorded cost" warning={forecast > totals.estimate} />
    </section>
    <PurchaseOrderBudgetSummary title="Show purchase orders" orders={purchaseOrdersForShow(purchaseOrders, showId)} currency={currency} />
    <PortfolioTable>
      <div className="grid grid-cols-[minmax(220px,1.6fr)_100px_135px_135px_135px_96px_34px] gap-3 bg-[#f5f5f1] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#747c77]">
        <span>Episode</span><span>Cost lines</span><span>Estimate</span><span>Actual</span><span>Variance</span><span>Health</span><span aria-hidden />
      </div>
      <div className="divide-y divide-[#efeeea]">
        {episodes.map((episode) => {
          const episodeLines = lines.filter((line) => line.episodeId === episode.id);
          const totals = sumLines(episodeLines);
          const currency = currencyFor(episodeLines);
          const variance = totals.actual - totals.estimate;
          return <Link key={episode.id} href={`/budget?network=${encodeURIComponent(network)}&show=${encodeURIComponent(show)}&episode=${episode.id}`} className="grid grid-cols-[minmax(220px,1.6fr)_100px_135px_135px_135px_96px_34px] items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-[#f8faf7]">
            <div className="min-w-0"><p className="truncate font-semibold text-[#37413d]">{episode.label.replace(`${show} · `, "")}</p><p className="mt-1 text-xs text-[#858a87]">Open episode cost ledger</p></div>
            <span className="text-[#5d6762]">{episodeLines.length}</span>
            <span className="font-medium text-[#4d5752]">{money(totals.estimate, currency)}</span>
            <span className="font-medium text-[#4d5752]">{money(totals.actual, currency)}</span>
            <span className={variance > 0 ? "font-medium text-[#a65f42]" : "font-medium text-[#4f7767]"}>{variance > 0 ? "+" : ""}{money(variance, currency)}</span>
            <BudgetHealth actual={totals.actual} estimate={totals.estimate} />
            <ArrowRight className="text-[#8b918d]" size={16} />
          </Link>;
        })}
      </div>
    </PortfolioTable>
  </div>;
}

function PortfolioTable({ children }: { children: React.ReactNode }) {
  return <section className="panel overflow-x-auto"><div className="min-w-[780px]">{children}</div></section>;
}

function sumLines(lines: Line[]) {
  return lines.reduce((sum, line) => ({ estimate: sum.estimate + Number(line.budgetedAmount), actual: sum.actual + Number(line.actualAmount) }), { estimate: 0, actual: 0 });
}

function sumPurchaseOrders(orders: PurchaseOrderSummary[]) {
  return orders.reduce((sum, order) => ({ authorised: sum.authorised + order.authorisedAmount, committed: sum.committed + order.committedAmount, actual: sum.actual + order.actualInvoicedAmount, remaining: sum.remaining + order.remainingAmount }), { authorised: 0, committed: 0, actual: 0, remaining: 0 });
}

function purchaseOrdersForShow(orders: PurchaseOrderSummary[], showId?: string) {
  return showId ? orders.filter((order) => order.showId === showId) : [];
}

/** An episode sees its own POs plus show-level authorisations shared across episodes. */
function purchaseOrdersForEpisode(orders: PurchaseOrderSummary[], episode: { id: string; showId: string }) {
  return orders.filter((order) => order.episodeId === episode.id || (order.showId === episode.showId && !order.episodeId));
}

/** An episode sees its own Client POs plus active show-level billing authority. */
function clientPurchaseOrdersForEpisode(orders: ClientPurchaseOrderSummary[], episode: { id: string; showId: string }) {
  return orders.filter((order) => order.episodeId === episode.id || (order.showId === episode.showId && !order.episodeId));
}

function ClientPoBudgetSafeguards({ orders }: { orders: ClientPurchaseOrderSummary[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const attention = orders.flatMap((order) => {
    const rows: Array<{ id: string; label: string; message: string }> = [];
    if (order.status === "active" && order.expiryDate && order.expiryDate < today) rows.push({ id: `${order.id}-expired`, label: order.poNumber, message: "Expired billing authority" });
    else if (order.status === "active" && order.expiryDate && Math.ceil((new Date(`${order.expiryDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000) <= 30) rows.push({ id: `${order.id}-expiring`, label: order.poNumber, message: "Expires within 30 days" });
    if (order.remainingAmount < 0) rows.push({ id: `${order.id}-over`, label: order.poNumber, message: `Over-authorised by ${money(Math.abs(order.remainingAmount), order.currency)}` });
    else if (order.status === "active" && order.remainingAmount === 0) rows.push({ id: `${order.id}-exhausted`, label: order.poNumber, message: "All value is committed" });
    return rows;
  });
  if (!attention.length) return null;
  return <section role="alert" className="panel border border-[#efd8cf] bg-[#fffaf7] px-5 py-4"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-[#8b4f38]">Client PO billing safeguards</p><p className="mt-1 text-xs leading-5 text-[#936044]">Review these billing authorities before posting further client change work or issuing an invoice.</p><ul className="mt-2 space-y-1 text-xs text-[#936044]">{attention.map((item) => <li key={item.id}>{item.label} · {item.message}</li>)}</ul></div><Link href="/budget/client-purchase-orders" className="shrink-0 text-xs font-semibold text-[#8b5b43] hover:underline">Open Client POs</Link></div></section>;
}

function PurchaseOrderBudgetSummary({ title, orders, currency }: { title: string; orders: PurchaseOrderSummary[]; currency: string }) {
  const totals = sumPurchaseOrders(orders);
  return <section className="panel overflow-hidden"><div className="flex flex-col justify-between gap-3 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold text-[#353b39]">{title}</h2><p className="mt-1 text-xs text-[#737b77]">Commitments are tracked separately from actual cost, room, and artist time.</p></div><Link href="/budget/purchase-orders" className="text-xs font-semibold text-[#58756b] hover:underline">Open PO register</Link></div>{orders.length === 0 ? <p className="px-5 py-7 text-sm text-[#858a87]">No purchase orders apply to this scope.</p> : <><div className="grid gap-3 border-b border-[#efeeea] px-5 py-3 text-xs sm:grid-cols-4"><Summary label="Authorised" value={money(totals.authorised, currency)} /><Summary label="Committed" value={money(totals.committed, currency)} /><Summary label="Actual invoiced" value={money(totals.actual, currency)} /><Summary label="Remaining" value={money(totals.remaining, currency)} warning={totals.remaining < 0} /></div><div className="divide-y divide-[#efeeea]">{orders.map((order) => { const expiry = purchaseOrderExpiryState(order.expiryDate, order.status); const warning = order.remainingAmount < 0 ? "Over-committed" : expiry; return <Link key={order.id} href={`/budget/purchase-orders/${order.id}`} className="grid gap-2 px-5 py-3 text-sm transition-colors hover:bg-[#f8faf7] sm:grid-cols-[minmax(0,1fr)_120px_120px_120px] sm:items-center"><div className="min-w-0"><p className="truncate font-semibold text-[#44504b]">{order.poNumber}</p><p className="mt-0.5 truncate text-xs text-[#858a87]">{order.vendorName ?? "Vendor"}{order.episodeTitle ? ` · E${String(order.episodeNumber ?? 0).padStart(2, "0")} ${order.episodeTitle}` : order.showTitle ? " · Show-wide" : " · Facility-wide"}</p>{warning && <p className="mt-1 text-xs font-semibold text-[#a65f42]">{warning}</p>}</div><span className="text-xs text-[#606a65]">Commit. {money(order.committedAmount, order.currency)}</span><span className="text-xs text-[#606a65]">Actual {money(order.actualInvoicedAmount, order.currency)}</span><span className={order.remainingAmount < 0 ? "text-xs font-semibold text-[#a65f42]" : "text-xs font-semibold text-[#4f7767]"}>Remain. {money(order.remainingAmount, order.currency)}</span></Link>; })}</div></>}</section>;
}

function purchaseOrderExpiryState(value: string | Date | null, status: string) {
  if (!value || status !== "approved") return null;
  const expiry = new Date(value); const today = new Date();
  expiry.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0);
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "Expired";
  if (days <= 14) return `Expires in ${days}d`;
  return null;
}

function Summary({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div><p className="uppercase tracking-[.08em] text-[#858a87]">{label}</p><p className={`mt-1 font-semibold ${warning ? "text-[#a65f42]" : "text-[#4d5752]"}`}>{value}</p></div>; }

function currencyFor(lines: Line[]) {
  return lines[0]?.currency ?? "USD";
}

function burnLabel(actual: number, estimate: number) {
  return estimate ? `${Math.round((actual / estimate) * 100)}%` : "No";
}

function BudgetHealth({ actual, estimate }: { actual: number; estimate: number }) {
  const percent = estimate ? Math.round((actual / estimate) * 100) : 0;
  const over = actual > estimate;
  return <span className={`inline-flex w-fit rounded-full px-2 py-1 text-[11px] font-semibold ${over ? "bg-[#fbebe5] text-[#a65f42]" : "bg-[#eaf3ed] text-[#4e7665]"}`}>{estimate ? `${percent}% ${over ? "over" : "spent"}` : "Unbudgeted"}</span>;
}

async function load(): Promise<BudgetData> {
  const [budget, options, purchaseOrders, clientPurchaseOrders, workOrderCharges] = await Promise.all([
      postpilotApiServerFetch<{ budget_lines: Array<Record<string, unknown>> }>("/budget/lines"),
      postpilotApiServerFetch<{ companies: Array<{ id: string; name: string; type: string }>; shows: Array<{ id: string; title: string; network: string | null }>; episodes: Array<{ id: string; show_id: string; show_title: string; number: number; title: string }>; services: Array<{ id: string; name: string; category: string; unit: string }>; rooms: Array<{ id: string; name: string; type: string }>; people: Array<{ id: string; name: string; role: string }> }>("/budget/options"),
      postpilotApiServerFetch<{ purchase_orders: Array<Record<string, unknown>> }>("/purchase-orders"),
      postpilotApiServerFetch<{ client_purchase_orders: Array<Record<string, unknown>> }>("/client-purchase-orders"),
      postpilotApiServerFetch<{ work_order_charges: Array<Record<string, unknown>> }>("/billing/work-order-charges"),
    ]);
    const episodeById = new Map(options.episodes.map((episode) => [episode.id, episode]));
    const showById = new Map(options.shows.map((show) => [show.id, show]));
  return {
      episodes: options.episodes.map((episode) => ({ id: episode.id, label: `${episode.show_title} · E${String(episode.number).padStart(2, "0")} ${episode.title}`, showId: episode.show_id, showTitle: episode.show_title, network: showById.get(episode.show_id)?.network ?? "Independent" })),
      resources: { services: options.services, rooms: options.rooms, people: options.people, vendors: options.companies.filter((company) => company.type === "vendor").map((company) => ({ id: company.id, name: company.name })) },
      lines: budget.budget_lines.map((line) => {
        const episode = line.episode_id ? episodeById.get(String(line.episode_id)) : undefined;
        const show = line.show_id ? showById.get(String(line.show_id)) : undefined;
        const order = line.purchase_order as Record<string, unknown> | null;
        return { id: String(line.id), workOrderId: (line.work_order as Record<string, unknown> | null)?.id ? String((line.work_order as Record<string, unknown>).id) : null, vendorInvoiceId: line.vendor_invoice_id ? String(line.vendor_invoice_id) : null, purchaseOrderId: order?.id ? String(order.id) : null, purchaseOrderNumber: order?.po_number ? String(order.po_number) : null, purchaseOrderAllocationId: null, externalCost: Boolean(line.external_cost), episodeId: line.episode_id ? String(line.episode_id) : null, episodeTitle: episode?.title ?? null, episodeNumber: episode?.number ?? null, category: String(line.category), description: line.description ? String(line.description) : null, showTitle: show?.title ?? null, network: show?.network ?? null, budgetedAmount: Number(line.estimated_amount ?? 0), actualAmount: Number(line.actual_amount ?? 0), currency: String(line.currency), costType: String(line.cost_type), showId: line.show_id ? String(line.show_id) : null };
      }),
      workOrderCharges: workOrderCharges.work_order_charges.map((charge) => ({
        id: String(charge.id), title: String(charge.title),
        status: String(charge.status), billingStatus: String(charge.billing_status), estimatedAmount: Number(charge.estimated_amount ?? 0),
        currency: String(charge.currency), billingNotes: charge.billing_notes ? String(charge.billing_notes) : null,
        episodeId: String(charge.episode_id), episodeTitle: String(charge.episode_title), episodeNumber: Number(charge.episode_number),
        showId: String(charge.show_id), showTitle: String(charge.show_title), clientCompanyId: charge.client_company_id ? String(charge.client_company_id) : null,
      })),
      purchaseOrders: purchaseOrders.purchase_orders.map((order) => ({ id: String(order.id), vendorCompanyId: String(order.vendor_company_id), vendorName: order.vendor_name ? String(order.vendor_name) : null, showId: order.show_id ? String(order.show_id) : null, showTitle: order.show_title ? String(order.show_title) : null, episodeId: order.episode_id ? String(order.episode_id) : null, episodeNumber: order.episode_number ? Number(order.episode_number) : null, episodeTitle: order.episode_title ? String(order.episode_title) : null, poNumber: String(order.po_number), currency: String(order.currency), approvedAmount: Number(order.authorised_amount ?? 0), issueDate: order.issue_date ? String(order.issue_date) : null, expiryDate: order.expiry_date ? String(order.expiry_date) : null, status: String(order.status), notes: order.notes ? String(order.notes) : null, externalDocumentUrl: order.external_document_url ? String(order.external_document_url) : null, createdAt: order.created_at ? new Date(String(order.created_at)) : new Date(), updatedAt: order.updated_at ? new Date(String(order.updated_at)) : new Date(), authorisedAmount: Number(order.authorised_amount ?? 0), committedAmount: Number(order.committed_amount ?? 0), actualInvoicedAmount: Number(order.actual_invoiced_amount ?? 0), remainingAmount: Number(order.remaining_amount ?? 0), varianceAmount: Number(order.variance_amount ?? 0) })) as unknown as PurchaseOrderSummary[],
      clientPurchaseOrders: clientPurchaseOrders.client_purchase_orders.map((order) => ({ id: String(order.id), clientCompanyId: String(order.client_company_id), clientName: order.client_name ? String(order.client_name) : null, showId: order.show_id ? String(order.show_id) : null, showTitle: order.show_title ? String(order.show_title) : null, episodeId: order.episode_id ? String(order.episode_id) : null, episodeNumber: order.episode_number ? Number(order.episode_number) : null, episodeTitle: order.episode_title ? String(order.episode_title) : null, poNumber: String(order.po_number), currency: String(order.currency), approvedAmount: Number(order.authorised_amount ?? 0), issueDate: order.issue_date ? String(order.issue_date) : null, expiryDate: order.expiry_date ? String(order.expiry_date) : null, status: String(order.status), notes: order.notes ? String(order.notes) : null, externalDocumentUrl: order.external_document_url ? String(order.external_document_url) : null, createdAt: order.created_at ? new Date(String(order.created_at)) : new Date(), updatedAt: order.updated_at ? new Date(String(order.updated_at)) : new Date(), authorisedAmount: Number(order.authorised_amount ?? 0), committedToBillAmount: Number(order.committed_to_bill_amount ?? 0), invoicedAmount: Number(order.invoiced_amount ?? 0), remainingAmount: Number(order.remaining_amount ?? 0), varianceAmount: Number(order.variance_amount ?? 0) })) as unknown as ClientPurchaseOrderSummary[],
  };
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), camelize(child)]));
}
