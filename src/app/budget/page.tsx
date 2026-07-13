import { AlertTriangle, CircleDollarSign, ReceiptText, TrendingUp } from "lucide-react";

import { BudgetLineForm } from "@/components/budget-line-form";
import { ServiceRateCard } from "@/components/service-rate-card";
import { WorkOrderChargeQueue } from "@/components/work-order-charge-queue";
import { getActiveOrganizationContext, getActiveShowName } from "@/lib/organizations";
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
  budgetedAmount: string | number;
  actualAmount: string | number;
  costType: string;
};

type BudgetData = {
  lines: Line[];
  episodes: Array<{ id: string; label: string; showTitle: string }>;
  workOrderCharges: Array<{ id: string; title: string; department: string | null; status: string; billingStatus: string; estimatedAmount: string | number | null; currency: string; billingNotes: string | null; episodeTitle: string; episodeNumber: number; showTitle: string }>;
};

export default async function BudgetPage() {
  if (!(await can("manage_budget"))) redirect("/");
  const activeShow = await getActiveShowName();
  const data = await load();
  const serviceRates = await loadServiceRates();
  const episodes = activeShow ? data.episodes.filter((episode) => episode.showTitle === activeShow) : data.episodes;
  const lines = activeShow ? data.lines.filter((line) => line.showTitle === activeShow) : data.lines;
  const totals = lines.reduce((sum, line) => ({ estimate: sum.estimate + Number(line.budgetedAmount), actual: sum.actual + Number(line.actualAmount) }), { estimate: 0, actual: 0 });
  const burn = totals.estimate ? Math.round((totals.actual / totals.estimate) * 100) : 0;
  const variance = totals.actual - totals.estimate;
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
        <p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Episode cost control{activeShow ? ` · ${activeShow}` : ""}</p>
        <h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Budget</h1>
        <p className="mt-1 text-sm text-[#747977]">Episode-level costs with show roll-ups for post-production control.</p>
      </div>
      <BudgetLineForm episodes={episodes} />
    </header>

    <section className="grid gap-3 sm:grid-cols-3">
      <Metric icon={<CircleDollarSign size={16} />} label="Estimated" value={money(totals.estimate)} detail={`${lines.length} cost lines`} />
      <Metric icon={<ReceiptText size={16} />} label="Actual" value={money(totals.actual)} detail={burn ? `${burn}% of estimate` : "No spend recorded"} />
      <Metric icon={variance > 0 ? <AlertTriangle size={16} /> : <TrendingUp size={16} />} label="Variance" value={`${variance > 0 ? "+" : ""}${money(variance)}`} detail={variance > 0 ? "Over estimate" : "Within estimate"} warning={variance > 0} />
    </section>

    <ServiceRateCard rates={serviceRates} />
    <WorkOrderChargeQueue charges={activeShow ? data.workOrderCharges.filter((charge) => charge.showTitle === activeShow) : data.workOrderCharges} />

    <section className="panel p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[.08em] text-[#7d837f]">Budget burn</p><p className="mt-1 text-sm text-[#69716d]">{activeShow ?? "All active shows"}</p></div>
        <p className="text-right text-2xl font-semibold tracking-[-.04em] text-[#2e3734]">{burn}% <span className="text-sm font-normal text-[#7d837f]">spent</span></p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${burn > 100 ? "bg-[#c17a4f]" : "bg-[#66877f]"}`} style={{ width: `${Math.min(burn, 100)}%` }} /></div>
      <p className="mt-3 text-sm text-[#68716d]">{money(totals.actual)} actual against {money(totals.estimate)} estimated.</p>
    </section>

    {episodeTotals.length > 0 && <section className="panel overflow-hidden">
      <div className="border-b border-[#ebeae6] px-5 py-3"><h2 className="text-sm font-semibold text-[#353b39]">Episode roll-up</h2></div>
      <div className="divide-y divide-[#efeeea]">{episodeTotals.map((episode) => {
        const episodeBurn = episode.estimate ? Math.round((episode.actual / episode.estimate) * 100) : 0;
        return <div key={episode.label} className="grid gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_80px] sm:items-center">
          <div className="min-w-0"><p className="truncate text-sm font-medium text-[#3d4642]">{episode.label}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${episodeBurn > 100 ? "bg-[#c17a4f]" : "bg-[#66877f]"}`} style={{ width: `${Math.min(episodeBurn, 100)}%` }} /></div></div>
          <p className="text-sm text-[#67706c]"><span className="sm:hidden">Estimate · </span>{money(episode.estimate)}</p>
          <p className="text-sm text-[#67706c]"><span className="sm:hidden">Actual · </span>{money(episode.actual)}</p>
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
          <p>{money(Number(line.budgetedAmount))}</p><p>{money(Number(line.actualAmount))}</p>
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

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

async function load(): Promise<BudgetData> {
  if (isDebugDemoMode) {
    const episodes = [{ id: "demo-e1", label: "Signal North · E01 The Quiet Hour", showTitle: "Signal North" }, { id: "demo-e5", label: "Under Current · E01 The Undertow", showTitle: "Under Current" }];
    return { episodes, workOrderCharges: [], lines: [
      { id: "b1", episodeId: "demo-e1", episodeTitle: "The Quiet Hour", episodeNumber: 1, category: "Edit suite", description: "Avid bays", showTitle: "Signal North", budgetedAmount: 48000, actualAmount: 42150, costType: "internal" },
      { id: "b2", episodeId: "demo-e1", episodeTitle: "The Quiet Hour", episodeNumber: 1, category: "VFX", description: "Cleanup and screens", showTitle: "Signal North", budgetedAmount: 78000, actualAmount: 82350, costType: "billable" },
      { id: "b3", episodeId: "demo-e5", episodeTitle: "The Undertow", episodeNumber: 1, category: "Sound", description: "Mix and stems", showTitle: "Under Current", budgetedAmount: 52000, actualAmount: 47120, costType: "internal" },
    ] };
  }
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return { lines: [], episodes: [], workOrderCharges: [] };
  const [budget, rows] = await Promise.all([getBudgetData(context.organization.organizationId), listEpisodes(context.organization.organizationId)]);
  return { lines: budget.lines, workOrderCharges: budget.workOrderCharges, episodes: rows.map((episode) => ({ id: episode.id, label: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} ${episode.title}`, showTitle: episode.showTitle })) };
}
