import { AlertTriangle, CircleDollarSign, ReceiptText, TrendingUp } from "lucide-react";
import Link from "next/link";

import { BudgetLineForm } from "@/components/budget-line-form";
import { RateOverrideCard } from "@/components/rate-override-card";
import { ServiceRateCard } from "@/components/service-rate-card";
import { WorkOrderChargeQueue } from "@/components/work-order-charge-queue";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { getBudgetData, listEpisodes, listServiceRates } from "@/server/data";
import { redirect } from "next/navigation";

type Line = {
  id: string;
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
  episodes: Array<{ id: string; label: string; showTitle: string }>;
  workOrderCharges: Array<{ id: string; title: string; department: string | null; status: string; billingStatus: string; estimatedAmount: string | number | null; currency: string; billingNotes: string | null; episodeTitle: string; episodeNumber: number; showTitle: string }>;
  commitments?: Array<{ id: string; amount: string | number | null; status: string; showTitle: string | null; vendorName: string }>;
};

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ network?: string; show?: string; episode?: string }> }) {
  if (!(await can("manage_budget"))) redirect("/");
  const params = await searchParams;
  const activeShow = params.show;
  const selectedNetwork = params.network;
  const data = await load();
  const serviceRates = await loadServiceRates();
  const selectedEpisodeId = params.episode;
  const networks = [...new Set(data.lines.map((line) => line.network ?? "Independent"))];
  if (!selectedNetwork) return <BudgetNetworkPicker networks={networks} lines={data.lines} rates={serviceRates} />;
  const showRows = [...new Map(data.lines.filter((line) => (line.network ?? "Independent") === selectedNetwork && line.showId && line.showTitle).map((line) => [line.showId!, { id: line.showId!, title: line.showTitle! }])).values()];
  const showNames = showRows.map((show) => show.title);
  if (!activeShow) return <BudgetShowPicker network={selectedNetwork} shows={showRows} lines={data.lines} rates={serviceRates} />;
  if (!showNames.includes(activeShow)) redirect(`/budget?network=${encodeURIComponent(selectedNetwork)}`);
  if (!selectedEpisodeId) return <BudgetEpisodePicker network={selectedNetwork} show={activeShow} episodes={data.episodes.filter((episode) => episode.showTitle === activeShow)} lines={data.lines.filter((line) => line.showTitle === activeShow)} rates={serviceRates} showId={showRows.find((show) => show.title === activeShow)?.id} />;
  const selectedEpisode = data.episodes.find((episode) => episode.id === selectedEpisodeId && episode.showTitle === activeShow);
  if (!selectedEpisode) redirect(`/budget?network=${encodeURIComponent(selectedNetwork)}&show=${encodeURIComponent(activeShow)}`);
  const episodes = [selectedEpisode];
  const lines = data.lines.filter((line) => line.episodeId === selectedEpisodeId && line.showTitle === activeShow);
  const currency = lines[0]?.currency ?? "USD";
  const totals = lines.reduce((sum, line) => ({ estimate: sum.estimate + Number(line.budgetedAmount), actual: sum.actual + Number(line.actualAmount) }), { estimate: 0, actual: 0 });
  const burn = totals.estimate ? Math.round((totals.actual / totals.estimate) * 100) : 0;
  const variance = totals.actual - totals.estimate;
  const committed = (data.commitments ?? []).filter((po) => po.showTitle === activeShow).reduce((sum, po) => sum + Number(po.amount ?? 0), 0);
  const forecast = totals.actual + committed;
  const episodeTotals = Object.values(lines.reduce<Record<string, { label: string; estimate: number; actual: number }>>((groups, line) => {
    const key = line.episodeId ?? line.id;
    groups[key] ??= { label: episodeLabel(line), estimate: 0, actual: 0 };
    groups[key].estimate += Number(line.budgetedAmount);
    groups[key].actual += Number(line.actualAmount);
    return groups;
  }, {}));

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Episode cost control · {activeShow}</p>
        <h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Budget</h1>
        <p className="mt-1 text-sm text-[#747977]">Episode-level costs with show roll-ups for post-production control.</p>
      </div>
      <div className="flex gap-2"><Link href={`/budget?network=${encodeURIComponent(selectedNetwork)}&show=${encodeURIComponent(activeShow)}`} className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#52635d]">All episodes</Link><BudgetLineForm episodes={episodes} /></div>
    </header>

    <section className="grid gap-3 sm:grid-cols-4">
      <Metric icon={<CircleDollarSign size={16} />} label="Estimated" value={money(totals.estimate, currency)} detail={`${lines.length} cost lines`} />
      <Metric icon={<ReceiptText size={16} />} label="Actual" value={money(totals.actual, currency)} detail={burn ? `${burn}% of estimate` : "No spend recorded"} />
      <Metric icon={<ReceiptText size={16} />} label="Committed" value={money(committed, currency)} detail="Open vendor POs" />
      <Metric icon={<TrendingUp size={16} />} label="Forecast" value={money(forecast, currency)} detail="Actual + committed" warning={forecast > totals.estimate} />
      <Metric icon={variance > 0 ? <AlertTriangle size={16} /> : <TrendingUp size={16} />} label="Variance" value={`${variance > 0 ? "+" : ""}${money(variance, currency)}`} detail={variance > 0 ? "Over estimate" : "Within estimate"} warning={variance > 0} />
    </section>

    <RateOverrideCard rates={serviceRates} scope={{ type: "episode", episodeId: selectedEpisodeId }} title="Episode service rate card" />
    <WorkOrderChargeQueue charges={activeShow ? data.workOrderCharges.filter((charge) => charge.showTitle === activeShow) : data.workOrderCharges} />

    <section className="panel p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[.08em] text-[#7d837f]">Budget burn</p><p className="mt-1 text-sm text-[#69716d]">{activeShow ?? "All active shows"}</p></div>
        <p className="text-right text-2xl font-semibold tracking-[-.04em] text-[#2e3734]">{burn}% <span className="text-sm font-normal text-[#7d837f]">spent</span></p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${burn > 100 ? "bg-[#c17a4f]" : "bg-[#66877f]"}`} style={{ width: `${Math.min(burn, 100)}%` }} /></div>
      <p className="mt-3 text-sm text-[#68716d]">{money(totals.actual, currency)} actual against {money(totals.estimate, currency)} estimated.</p>
    </section>

    {episodeTotals.length > 0 && <section className="panel overflow-hidden">
      <div className="border-b border-[#ebeae6] px-5 py-3"><h2 className="text-sm font-semibold text-[#353b39]">Episode roll-up</h2></div>
      <div className="divide-y divide-[#efeeea]">{episodeTotals.map((episode) => {
        const episodeBurn = episode.estimate ? Math.round((episode.actual / episode.estimate) * 100) : 0;
        return <div key={episode.label} className="grid gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_80px] sm:items-center">
          <div className="min-w-0"><p className="truncate text-sm font-medium text-[#3d4642]">{episode.label}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${episodeBurn > 100 ? "bg-[#c17a4f]" : "bg-[#66877f]"}`} style={{ width: `${Math.min(episodeBurn, 100)}%` }} /></div></div>
          <p className="text-sm text-[#67706c]"><span className="sm:hidden">Estimate · </span>{money(episode.estimate, currency)}</p>
          <p className="text-sm text-[#67706c]"><span className="sm:hidden">Actual · </span>{money(episode.actual, currency)}</p>
          <p className={`text-sm font-semibold ${episodeBurn > 100 ? "text-[#a65f42]" : "text-[#4f7767]"}`}>{episodeBurn}%</p>
        </div>;
      })}</div>
    </section>}

    <section className="panel overflow-hidden">
      <div className="border-b border-[#ebeae6] px-5 py-3"><h2 className="text-sm font-semibold text-[#353b39]">Cost lines</h2></div>
      {lines.length === 0 ? <div className="px-5 py-12 text-center text-sm text-[#7d837f]">No episode budget lines match this show. Add the first line to begin tracking spend.</div> : <div className="overflow-x-auto"><div className="min-w-[760px]">
        <div className="grid grid-cols-[minmax(210px,1.3fr)_190px_140px_110px_110px_90px] gap-3 bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e837f]"><span>Category</span><span>Episode</span><span>Show</span><span>Estimate</span><span>Actual</span><span>Type</span></div>
        <div className="divide-y divide-[#efeeea]">{lines.map((line) => <div key={line.id} className="grid grid-cols-[minmax(210px,1.3fr)_190px_140px_110px_110px_90px] gap-3 px-5 py-3 text-sm text-[#4f5753]">
          <div className="min-w-0"><p className="font-medium text-[#39423e]">{line.category}</p>{line.description && <p className="mt-0.5 truncate text-xs text-[#858a87]">{line.description}</p>}</div>
          <p className="truncate text-xs text-[#626b67]">{episodeLabel(line)}</p>
          <p className="truncate text-xs text-[#626b67]">{line.showTitle ?? "—"}</p>
          <p>{money(Number(line.budgetedAmount), line.currency)}</p><p>{money(Number(line.actualAmount), line.currency)}</p>
          <p className="capitalize text-xs text-[#6d7672]">{line.costType}</p>
        </div>)}</div>
      </div></div>}
    </section>
  </div>;
}

async function loadServiceRates() {
  if (isDebugDemoMode) return [];
  const context = await getActiveOrganizationContext();
  return context?.organization ? listServiceRates(context.organization.organizationId) : [];
}

function Metric({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="panel p-4"><div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[.08em] ${warning ? "text-[#a65f42]" : "text-[#76807b]"}`}>{icon}{label}</div><p className="mt-3 text-xl font-semibold tracking-[-.035em] text-[#343d39]">{value}</p><p className="mt-1 text-xs text-[#858a87]">{detail}</p></div>;
}

function episodeLabel(line: Line) {
  return line.episodeTitle ? `E${String(line.episodeNumber ?? 0).padStart(2, "0")} ${line.episodeTitle}` : "Unassigned legacy line";
}

function money(value: number, currency = "USD") {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; }
}

function BudgetNetworkPicker({ networks, lines, rates }: { networks: string[]; lines: Line[]; rates: React.ComponentProps<typeof ServiceRateCard>["rates"] }) { return <div className="space-y-5"><header><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Commercial control</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Budget</h1><p className="mt-1 text-sm text-[#747977]">Start with the network or client, then drill into a show and episode.</p></header><section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{networks.map((network) => { const networkLines = lines.filter((line) => (line.network ?? "Independent") === network); const estimate = networkLines.reduce((sum, line) => sum + Number(line.budgetedAmount), 0); const actual = networkLines.reduce((sum, line) => sum + Number(line.actualAmount), 0); return <div key={network} className="panel p-5"><Link href={`/budget?network=${encodeURIComponent(network)}`} className="block hover:text-[#58756b]"><p className="text-base font-semibold text-[#3d4642]">{network}</p><p className="mt-1 text-xs text-[#858a87]">{new Set(networkLines.map((line) => line.showTitle)).size} shows · {money(estimate)} estimate</p><p className="mt-4 text-xs"><b>{money(actual)}</b> actual</p></Link><div className="mt-4"><RateOverrideCard rates={rates} scope={{ type: "network", network }} title={`${network} rate card`} /></div></div>; })}</section></div>; }
function BudgetShowPicker({ network, shows, lines, rates }: { network: string; shows: Array<{ id: string; title: string }>; lines: Line[]; rates: React.ComponentProps<typeof ServiceRateCard>["rates"] }) { return <div className="space-y-5"><header><Link href="/budget" className="text-xs font-semibold text-[#58756b]">← All networks</Link><p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">{network}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Choose a show</h1></header><section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shows.map((show) => { const showLines = lines.filter((line) => line.showId === show.id); const estimate = showLines.reduce((sum, line) => sum + Number(line.budgetedAmount), 0); const actual = showLines.reduce((sum, line) => sum + Number(line.actualAmount), 0); return <div key={show.id} className="panel p-5"><Link href={`/budget?network=${encodeURIComponent(network)}&show=${encodeURIComponent(show.title)}`} className="block hover:text-[#58756b]"><p className="text-base font-semibold text-[#3d4642]">{show.title}</p><p className="mt-1 text-xs text-[#858a87]">{money(estimate)} estimate · {money(actual)} actual</p></Link><div className="mt-4"><RateOverrideCard rates={rates} scope={{ type: "show", showId: show.id }} title="Show service rate card" /></div></div>; })}</section></div>; }
function BudgetEpisodePicker({ network, show, episodes, lines, rates, showId }: { network: string; show: string; episodes: Array<{ id: string; label: string; showTitle: string }>; lines: Line[]; rates: React.ComponentProps<typeof ServiceRateCard>["rates"]; showId?: string }) { return <div className="space-y-5"><header><Link href={`/budget?network=${encodeURIComponent(network)}`} className="text-xs font-semibold text-[#58756b]">← {network}</Link><p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">{show}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Choose an episode</h1></header>{showId && <RateOverrideCard rates={rates} scope={{ type: "show", showId }} title="Show service rate card" />}<section className="panel divide-y divide-[#efeeea]">{episodes.map((episode) => { const episodeLines = lines.filter((line) => line.episodeId === episode.id); const estimate = episodeLines.reduce((sum, line) => sum + Number(line.budgetedAmount), 0); const actual = episodeLines.reduce((sum, line) => sum + Number(line.actualAmount), 0); return <Link key={episode.id} href={`/budget?network=${encodeURIComponent(network)}&show=${encodeURIComponent(show)}&episode=${episode.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#fbfbf9]"><span><b className="text-sm text-[#3d4642]">{episode.label.replace(`${show} · `, "")}</b></span><span className="text-right text-xs"><b>{money(actual)}</b><small className="mt-1 block text-[#858a87]">of {money(estimate)}</small></span></Link>; })}</section></div>; }

async function load(): Promise<BudgetData> {
  if (isDebugDemoMode) {
    const episodes = [{ id: "demo-e1", label: "Signal North · E01 The Quiet Hour", showTitle: "Signal North" }, { id: "demo-e5", label: "Under Current · E01 The Undertow", showTitle: "Under Current" }];
    return { episodes, workOrderCharges: [], commitments: [], lines: [
      { id: "b1", episodeId: "demo-e1", episodeTitle: "The Quiet Hour", episodeNumber: 1, category: "Edit suite", description: "Avid bays", showId: "demo-s1", showTitle: "Signal North", network: "Northstar Network", budgetedAmount: 48000, actualAmount: 42150, currency: "GBP", costType: "internal" },
      { id: "b2", episodeId: "demo-e1", episodeTitle: "The Quiet Hour", episodeNumber: 1, category: "VFX", description: "Cleanup and screens", showId: "demo-s1", showTitle: "Signal North", network: "Northstar Network", budgetedAmount: 78000, actualAmount: 82350, currency: "GBP", costType: "billable" },
      { id: "b3", episodeId: "demo-e5", episodeTitle: "The Undertow", episodeNumber: 1, category: "Sound", description: "Mix and stems", showId: "demo-s2", showTitle: "Under Current", network: "Eastline", budgetedAmount: 52000, actualAmount: 47120, currency: "GBP", costType: "internal" },
    ] };
  }
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return { lines: [], episodes: [], workOrderCharges: [], commitments: [] };
  const [budget, rows] = await Promise.all([getBudgetData(context.organization.organizationId), listEpisodes(context.organization.organizationId)]);
  return { lines: budget.lines, workOrderCharges: budget.workOrderCharges, commitments: budget.commitments, episodes: rows.map((episode) => ({ id: episode.id, label: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} ${episode.title}`, showTitle: episode.showTitle })) };
}
