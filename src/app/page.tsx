import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  DollarSign,
  Film,
  Gauge,
  ListChecks,
  Plus,
  RadioTower,
} from "lucide-react";

import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can, getCurrentPerson, isExternalReviewerRole } from "@/lib/permissions";
import { redirect } from "next/navigation";
import {
  getBudgetData,
  getDashboardData,
  getDemoCommandCenterData,
  listDeliverables,
  listSchedule,
  listShows,
  listTeam,
} from "@/server/data";

const statusStyles: Record<string, string> = {
  draft: "bg-[#eceae6] text-[#707572]",
  in_review: "bg-[#e7ecfb] text-[#4c68ba]",
  approved: "bg-[#e5f1eb] text-[#3d8065]",
  changes_requested: "bg-[#f9e8dc] text-[#aa6338]",
  qc: "bg-[#f8e8e2] text-[#a35d4a]",
  ready: "bg-[#e6f0ed] text-[#3d7d70]",
  in_progress: "bg-[#e8edf4] text-[#536a88]",
  delivered: "bg-[#e4f0e8] text-[#3c785e]",
};

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function DashboardPage() {
  const [currentPerson, organizationContext, mayManageShows] = await Promise.all([getCurrentPerson(), getActiveOrganizationContext(), can("manage_shows")]);
  if (!organizationContext?.organization && !isDebugDemoMode) {
    return (
      <div className="panel mx-auto mt-20 max-w-lg p-8 text-center">
        <RadioTower className="mx-auto text-[#78807d]" size={28} />
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.03em]">No post workspace selected</h1>
        <p className="mt-2 text-sm leading-6 text-[#737776]">Your account is authenticated, but it is not yet a member of a PostPilot organization.</p>
      </div>
    );
  }
  const isRestrictedExternalReviewer = isExternalReviewerRole(currentPerson?.role) && !(currentPerson?.role === "director" && mayManageShows);
  if (isRestrictedExternalReviewer) redirect("/review");
  // Keep the focused default landing pages for non-manager facility roles,
  // but do not override a tenant policy that grants wider management access.
  if (!mayManageShows && currentPerson?.role === "runner") redirect("/runner");
  if (!mayManageShows && currentPerson?.role === "finance") redirect("/budget");
  if (!mayManageShows && ["editor", "assistant_editor", "colorist", "sound_mixer", "qc", "vfx_coordinator"].includes(currentPerson?.role ?? "")) redirect("/episodes");
  const screen = await getCommandCenterData();

  if (!screen) {
    return (
      <div className="panel mx-auto mt-20 max-w-lg p-8 text-center">
        <RadioTower className="mx-auto text-[#78807d]" size={28} />
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.03em]">No post workspace selected</h1>
        <p className="mt-2 text-sm leading-6 text-[#737776]">Your account is authenticated, but it is not yet a member of a PostPilot organization.</p>
      </div>
    );
  }

  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + 7);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);

  const { dashboard, showRows, deliverables, schedule, budget, team, organizationName, isDemo } = screen;

  const activeShows = showRows.filter((show) => show.seasons.some((season) => season.activeEpisodeCount > 0));
  const dueThisWeek = dashboard.episodes.filter((episode) => episode.deliveryDeadline && episode.deliveryDeadline >= weekStart && episode.deliveryDeadline <= endOfWeek);
  const lockedCuts = dashboard.episodes.filter((episode) => episode.status === "locked");
  const qcFailures = dashboard.episodes.filter((episode) => episode.qcStatus === "needs_attention");
  const deliveryDeadlines = deliverables.filter((deliverable) => deliverable.status !== "delivered" && deliverable.dueAt).slice(0, 5);
  const budgetBurn = budget.totals.budgeted ? Math.round((budget.totals.actual / budget.totals.budgeted) * 100) : 0;
  const suiteHours = schedule.reduce<Record<string, number>>((total, booking) => {
    if (!booking.roomName) return total;
    const hours = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 3_600_000;
    total[booking.roomName] = (total[booking.roomName] ?? 0) + hours;
    return total;
  }, {});
  const suites = Object.entries(suiteHours).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const workload = team.map((member) => ({ ...member, hours: schedule.filter((booking) => booking.personName === member.name).reduce((sum, booking) => sum + (booking.endsAt.getTime() - booking.startsAt.getTime()) / 3_600_000, 0) })).sort((a, b) => b.hours - a.hours).slice(0, 5);

  return (
    <div className="space-y-5 pb-6">
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]"><span className={`h-1.5 w-1.5 rounded-full ${isDemo ? "bg-[#bd7c4d]" : "bg-[#5b887e]"}`} /> {isDemo ? "Demo data" : "Live operations"} · {organizationName}</div>
          <h1 className="text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Post-production command center</h1>
          <p className="mt-1 text-sm text-[#747977]">Production health, capacity, and risk across every active show.</p>
        </div>
        <div className="flex items-center gap-2"><Link href="/bookings" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#e4e4df] bg-white px-3 text-sm font-medium text-[#4e5653] shadow-sm hover:bg-[#fafaf8]"><CalendarDays size={15} /> Next 7 days</Link><Link href="/bookings" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#263130] px-3 text-sm font-medium text-white hover:bg-[#394542]"><Plus size={16} /> New work</Link></div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <Metric href="/shows" label="Active shows" value={String(activeShows.length)} detail={`${showRows.length} total shows`} icon={<Film size={15} />} />
        <Metric href="/episodes" label="Episodes due" value={String(dueThisWeek.length)} detail="Next 7 days" icon={<Clock3 size={15} />} alert={dueThisWeek.length > 0} />
        <Metric href="/review" label="Locks awaiting approval" value={String(lockedCuts.length)} detail="Picture lock stage" icon={<CheckCircle2 size={15} />} />
        <Metric href="/episodes" label="QC failures" value={String(qcFailures.length)} detail="Need attention" icon={<CircleAlert size={15} />} alert={qcFailures.length > 0} />
        <Metric href="/deliverables" label="Open deliveries" value={String(deliveryDeadlines.length)} detail="Targeting this week" icon={<ListChecks size={15} />} />
        <Metric href="/budget" label="Budget burn" value={`${budgetBurn}%`} detail={`${formatMoney(budget.totals.actual)} actual`} icon={<DollarSign size={15} />} alert={budgetBurn > 90} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.58fr)_minmax(330px,0.82fr)]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#ebeae6] px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-[#303534]">Delivery deadlines</h2>
              <p className="mt-0.5 text-xs text-[#838886]">Network, streaming, M&E, captions, audio stems, and masters</p>
            </div>
            <Link href="/deliverables" className="flex items-center gap-1 text-xs font-medium text-[#526d69] hover:text-[#314a45]">Deliverables <ChevronRight size={14} /></Link>
          </div>
          <div className="divide-y divide-[#efeeea]">
            {deliveryDeadlines.length ? deliveryDeadlines.map((delivery) => (
              <Link href="/deliverables" key={delivery.id} className="grid gap-3 px-5 py-3 transition hover:bg-[#fbfbf9] sm:grid-cols-[minmax(0,1fr)_110px_110px] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#363b3a]">{delivery.name}</p>
                  <p className="mt-1 truncate text-xs text-[#838886]">{delivery.showTitle} · E{String(delivery.episodeNumber).padStart(2, "0")} {delivery.episodeTitle} · {delivery.destination}</p>
                </div>
                <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${statusStyles[delivery.status] ?? statusStyles.draft}`}>{statusLabel(delivery.status)}</span>
                <p className="text-xs font-medium text-[#8c633f]">Due {formatDate(delivery.dueAt)}</p>
              </Link>
            )) : <EmptyRow label="No delivery deadlines in the selected period." />}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <div><h2 className="text-sm font-semibold text-[#303534]">Suite utilization</h2><p className="mt-0.5 text-xs text-[#838886]">Booked hours · next 7 days</p></div>
            <Gauge size={17} className="text-[#75827f]" />
          </div>
          <div className="mt-5 space-y-3.5">
            {suites.length ? suites.map(([suite, hours]) => {
              const usage = Math.min(100, Math.round((hours / 40) * 100));
              return <div key={suite}><div className="mb-1.5 flex justify-between text-xs"><span className="font-medium text-[#535a57]">{suite}</span><span className="text-[#858a87]">{hours.toFixed(0)}h · {usage}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${usage > 80 ? "bg-[#c17a4d]" : "bg-[#63877f]"}`} style={{ width: `${usage}%` }} /></div></div>;
            }) : <p className="text-sm text-[#858986]">No suite bookings this week.</p>}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-[#ecebe7] pt-4 text-xs"><span className="text-[#808582]">{schedule.length} booked sessions</span><Link href="/bookings" className="font-medium text-[#536c68] hover:text-[#314a45]">View bookings <ArrowRight className="ml-1 inline" size={13} /></Link></div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1.12fr)_minmax(300px,0.76fr)]">
        <div className="panel overflow-hidden">
          <SectionHeading title="Approval & QC queue" detail="Picture locks and technical exceptions" action="Review queue" href="/review" />
          <div className="divide-y divide-[#efeeea]">
            {[...lockedCuts, ...qcFailures].slice(0, 5).map((episode) => (
              <Link href={`/episodes/${episode.id}`} key={`${episode.id}-${episode.qcStatus}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-[#fbfbf9]">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${episode.qcStatus === "needs_attention" ? "bg-[#f7e5dd] text-[#a96347]" : "bg-[#e6ece8] text-[#4e746b]"}`}>{episode.qcStatus === "needs_attention" ? "QC" : "LK"}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[#3a403e]">{episode.showTitle} · E{String(episode.number).padStart(2, "0")} {episode.title}</p><p className="mt-0.5 text-xs text-[#858987]">{episode.qcStatus === "needs_attention" ? "Technical QC failure · escalation needed" : "Picture locked · client approval pending"}</p></div>
                <span className="text-[11px] font-medium text-[#7c817f]">{formatDate(episode.deliveryDeadline)}</span>
              </Link>
            ))}
            {!lockedCuts.length && !qcFailures.length && <EmptyRow label="No approval or QC risks currently open." />}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <SectionHeading title="Artist workload" detail="Booked hours in the next 7 days" action="Team" href="/team" />
          <div className="divide-y divide-[#efeeea]">
            {workload.map((artist) => {
              const utilization = Math.min(100, Math.round((artist.hours / 40) * 100));
              return <Link href="/team" key={artist.id} className="flex items-center gap-3 px-5 py-3 transition hover:bg-[#fbfbf9]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e5e8e4] text-[10px] font-bold text-[#59645f]">{artist.name.split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className="truncate text-sm font-medium text-[#3a403e]">{artist.name}</p><span className="text-[11px] text-[#7f8582]">{artist.hours.toFixed(0)}h</span></div><p className="mt-0.5 text-xs capitalize text-[#858987]">{artist.role.replaceAll("_", " ")}</p><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ebeae6]"><div className="h-full rounded-full bg-[#66847e]" style={{ width: `${utilization}%` }} /></div></div></Link>;
            })}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold text-[#303534]">Budget health</h2><p className="mt-0.5 text-xs text-[#838886]">Current estimate vs actual</p></div><DollarSign size={17} className="text-[#76807d]" /></div>
          <div className="mt-6 flex items-end gap-3"><p className="text-3xl font-semibold tracking-[-0.05em] text-[#2f3533]">{budgetBurn}%</p><p className="pb-1 text-xs text-[#777e7b]">burned</p></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${budgetBurn > 90 ? "bg-[#bd7650]" : "bg-[#64847e]"}`} style={{ width: `${Math.min(100, budgetBurn)}%` }} /></div>
          <dl className="mt-5 space-y-2.5 text-xs"><div className="flex justify-between"><dt className="text-[#7d827f]">Estimate</dt><dd className="font-medium text-[#464d4a]">{formatMoney(budget.totals.budgeted)}</dd></div><div className="flex justify-between"><dt className="text-[#7d827f]">Actual</dt><dd className="font-medium text-[#464d4a]">{formatMoney(budget.totals.actual)}</dd></div><div className="flex justify-between border-t border-[#ecebe7] pt-2.5"><dt className="text-[#7d827f]">Variance</dt><dd className={`font-semibold ${budget.totals.actual > budget.totals.budgeted ? "text-[#ac633f]" : "text-[#4d8068]"}`}>{formatMoney(budget.totals.actual - budget.totals.budgeted)}</dd></div></dl>
          <Link href="/budget" className="mt-5 flex items-center gap-1 text-xs font-medium text-[#526d69] hover:text-[#314a45]">Open budget <ArrowRight size={13} /></Link>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SectionHeading title="Recent activity" detail="Latest movement across the post floor" action="Open modules" href="/episodes" />
        <div className="grid divide-y divide-[#efeeea] md:grid-cols-2 md:divide-x md:divide-y-0">
          {dashboard.activity.slice(0, 6).map((item) => <Link href={activityHref(item.entityType)} key={item.id} className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-[#fbfbf9]"><span className="mt-1 flex h-6 w-6 items-center justify-center rounded-md bg-[#eff1ee] text-[#72807b]"><Activity size={13} /></span><div><p className="text-sm font-medium text-[#3b413f]">{activityLabel(item.action)}</p><p className="mt-0.5 text-xs text-[#858987]">{formatActivityDetail(item.metadata)} · {formatDate(item.createdAt)}</p></div></Link>)}
          {!dashboard.activity.length && <EmptyRow label="No recent operational activity." />}
        </div>
      </section>
    </div>
  );
}

async function getCommandCenterData() {
  if (isDebugDemoMode) return { ...getDemoCommandCenterData(), isDemo: true };

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return null;

  const organizationId = context.organization.organizationId;
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + 7);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  const [dashboard, showRows, deliverables, schedule, budget, team] = await Promise.all([
    getDashboardData(organizationId),
    listShows(organizationId),
    listDeliverables(organizationId),
    listSchedule(organizationId, weekStart, endOfWeek),
    getBudgetData(organizationId),
    listTeam(organizationId),
  ]);
  return { organizationName: context.organization.organizationName, dashboard, showRows, deliverables, schedule, budget, team, isDemo: false };
}

function Metric({ href, label, value, detail, icon, alert = false }: { href: string; label: string; value: string; detail: string; icon: React.ReactNode; alert?: boolean }) {
  return <Link href={href} className="panel min-w-0 p-3.5 transition hover:-translate-y-0.5 hover:border-[#d6d8d2] hover:shadow-sm"><div className="flex items-center justify-between gap-2"><p className="truncate text-[11px] font-medium text-[#777d7a]">{label}</p><span className={alert ? "text-[#b47049]" : "text-[#8d9490]"}>{icon}</span></div><div className="mt-2 flex items-end justify-between gap-2"><p className="text-[23px] font-semibold leading-none tracking-[-0.045em] text-[#303534]">{value}</p><p className={`truncate text-[10px] ${alert ? "font-medium text-[#a86843]" : "text-[#858a87]"}`}>{detail}</p></div></Link>;
}

function SectionHeading({ title, detail, action, href }: { title: string; detail: string; action: string; href: string }) {
  return <div className="flex items-center justify-between border-b border-[#ebeae6] px-5 py-3.5"><div><h2 className="text-sm font-semibold text-[#303534]">{title}</h2><p className="mt-0.5 text-xs text-[#838886]">{detail}</p></div><Link href={href} className="flex items-center gap-1 text-xs font-medium text-[#526d69] hover:text-[#314a45]">{action} <ChevronRight size={14} /></Link></div>;
}

function EmptyRow({ label }: { label: string }) {
  return <div className="px-5 py-7 text-center text-sm text-[#858987]">{label}</div>;
}

function activityLabel(action: string) {
  return action.replaceAll(".", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatActivityDetail(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return "Operational update";
  const values = Object.values(metadata as Record<string, unknown>).filter((value) => typeof value === "string" || typeof value === "number");
  return values.length ? values.join(" · ") : "Operational update";
}

function activityHref(entityType: string) {
  if (entityType === "review_cut") return "/review";
  if (entityType === "deliverable") return "/deliverables";
  if (entityType === "booking") return "/bookings";
  if (entityType === "budget_line") return "/budget";
  return "/episodes";
}
