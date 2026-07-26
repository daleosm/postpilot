import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  DollarSign,
  Film,
  Gauge,
  Plus,
  RadioTower,
  ShieldAlert,
  Truck,
  Wrench,
} from "lucide-react";

import { getActiveOrganizationContext } from "@/lib/organizations";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { PanelHeader, SectionAction, SideSummary } from "@/components/operations-ui";

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

type CommandEpisode = {
  id: string;
  title: string;
  number: number;
  qcStatus: string;
  deliveryDeadline: Date | null;
  showTitle: string;
  workflowStageKey: string | null;
  status: string;
};

type DashboardBooking = { id: string; title: string; startsAt: Date; endsAt: Date; roomName: string | null; personName: string | null };
type BlockingWorkOrder = { id: string; title: string; priority: string; status: string; dueAt: Date | null; episodeId: string; episodeTitle: string; episodeNumber: number; showTitle: string; workflowStageName: string | null };
type OperationalTimelineItem = { id: string; title: string; context: string; href: string; at: Date | null; tone: "danger" | "attention" | "calm"; icon: React.ReactNode; label: string };

function formatToday(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", month: "long", day: "numeric" }).format(value);
}

function buildOperationalTimeline({ lockedCuts, qcFailures, dueThisWeek, schedule, blockingWorkOrders, now }: { lockedCuts: CommandEpisode[]; qcFailures: CommandEpisode[]; dueThisWeek: CommandEpisode[]; schedule: DashboardBooking[]; blockingWorkOrders: BlockingWorkOrder[]; now: Date }): OperationalTimelineItem[] {
  const items: OperationalTimelineItem[] = [
    ...blockingWorkOrders.map((workOrder) => ({
      id: `work-order-${workOrder.id}`,
      title: `Blocking work · ${workOrder.title}`,
      context: `${workOrder.showTitle} · E${String(workOrder.episodeNumber).padStart(2, "0")} · ${workOrder.workflowStageName ?? "Unassigned stage"}`,
      href: `/episodes/${workOrder.episodeId}`,
      at: workOrder.dueAt,
      tone: "danger" as const,
      icon: <Wrench size={15} />,
      label: workOrder.priority === "blocker" ? "Blocker" : "Blocking work",
    })),
    ...qcFailures.map((episode) => ({
      id: `qc-${episode.id}`,
      title: `QC failure · ${episode.title}`,
      context: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} · technical issue needs clearance`,
      href: `/episodes/${episode.id}`,
      at: episode.deliveryDeadline,
      tone: "danger" as const,
      icon: <ShieldAlert size={15} />,
      label: "QC attention",
    })),
    ...lockedCuts.map((episode) => ({
      id: `approval-${episode.id}`,
      title: `Sign-off waiting · ${episode.title}`,
      context: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} · picture lock`,
      href: `/episodes/${episode.id}`,
      at: episode.deliveryDeadline,
      tone: "attention" as const,
      icon: <CheckCircle2 size={15} />,
      label: "Approval",
    })),
    ...dueThisWeek.map((episode) => ({
      id: `delivery-${episode.id}`,
      title: `Delivery due · ${episode.title}`,
      context: `${episode.showTitle} · E${String(episode.number).padStart(2, "0")} · ${formatDate(episode.deliveryDeadline)}`,
      href: `/episodes/${episode.id}`,
      at: episode.deliveryDeadline,
      tone: "attention" as const,
      icon: <Truck size={15} />,
      label: "Delivery",
    })),
    ...schedule.filter((booking) => booking.endsAt >= now).slice(0, 4).map((booking) => ({
      id: `booking-${booking.id}`,
      title: `Booked · ${booking.title}`,
      context: [booking.roomName, booking.personName].filter(Boolean).join(" · ") || "Facility booking",
      href: "/bookings",
      at: booking.startsAt,
      tone: "calm" as const,
      icon: <CalendarClock size={15} />,
      label: "Booking",
    })),
  ];
  const priority = { danger: 0, attention: 1, calm: 2 };
  return items.sort((left, right) => priority[left.tone] - priority[right.tone] || (left.at?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.at?.getTime() ?? Number.MAX_SAFE_INTEGER)).slice(0, 10);
}

export default async function DashboardPage() {
  const [organizationContext, mayManageShows, mayManageBudget, mayManageCatering] = await Promise.all([getActiveOrganizationContext(), can("manage_shows"), can("manage_budget"), can("manage_catering")]);
  if (!organizationContext?.organization) {
    return (
      <div className="panel mx-auto mt-20 max-w-lg p-8 text-center">
        <RadioTower className="mx-auto text-[#78807d]" size={28} />
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.03em]">No post workspace selected</h1>
        <p className="mt-2 text-sm leading-6 text-[#737776]">Your account is authenticated, but it is not yet a member of a PostPilot organization.</p>
      </div>
    );
  }
  if (organizationContext?.organization?.role === "client") {
    if (organizationContext.person) redirect("/review");
    return <div className="panel mx-auto mt-20 max-w-lg p-8 text-center"><h1 className="text-xl font-semibold tracking-[-0.03em]">No episodes shared</h1><p className="mt-2 text-sm leading-6 text-[#737776]">Ask the post-production team to add you to an episode before you can view its workspace.</p></div>;
  }
  if (!mayManageShows && mayManageCatering) redirect("/runner");
  if (!mayManageShows && mayManageBudget) redirect("/budget");
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

  const { dashboard, showRows, schedule, budget, team, blockingWorkOrders, organizationName, isDemo } = screen;
  const currency = organizationContext?.organization?.currency ?? "GBP";

  const activeShows = showRows.filter((show) => show.seasons.some((season) => season.activeEpisodeCount > 0));
  const dueThisWeek = dashboard.episodes.filter((episode) => episode.deliveryDeadline && episode.deliveryDeadline >= weekStart && episode.deliveryDeadline <= endOfWeek);
  const lockedCuts = dashboard.episodes.filter((episode) => episode.workflowStageKey === "picture_lock" && episode.status === "awaiting_sign_off");
  const qcFailures = dashboard.episodes.filter((episode) => episode.qcStatus === "needs_attention");
  const budgetBurn = budget ? (budget.totals.budgeted ? Math.round((budget.totals.actual / budget.totals.budgeted) * 100) : 0) : null;
  const suiteHours = schedule.reduce<Record<string, number>>((total, booking) => {
    if (!booking.roomName) return total;
    const hours = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 3_600_000;
    total[booking.roomName] = (total[booking.roomName] ?? 0) + hours;
    return total;
  }, {});
  const suites = Object.entries(suiteHours).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const workload = team.map((member) => ({ ...member, hours: schedule.filter((booking) => booking.personName === member.name).reduce((sum, booking) => sum + (booking.endsAt.getTime() - booking.startsAt.getTime()) / 3_600_000, 0) })).sort((a, b) => b.hours - a.hours).slice(0, 5);
  const attentionCount = lockedCuts.length + qcFailures.length + blockingWorkOrders.length;
  const operationalTimeline = buildOperationalTimeline({ lockedCuts, qcFailures, dueThisWeek, schedule, blockingWorkOrders, now });

  return (
    <div className="space-y-5 pb-6">
      <section className="dashboard-hero dashboard-command-center flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]"><span className={`h-1.5 w-1.5 rounded-full ${isDemo ? "bg-[#bd7c4d]" : "bg-[#5b887e]"}`} /> {isDemo ? "Demo data" : "Live operations"} · {organizationName}</div>
          <h1 className="text-[28px] font-semibold tracking-[-0.052em] text-[#202524] sm:text-[31px]">Today in post</h1>
          <p className="mt-1.5 text-sm text-[#68736e]">{formatToday(now)} · capacity, approvals, and delivery risk in one live view.</p>
        </div>
        <div className="dashboard-command-center__aside">
          <div className="dashboard-command-center__signals" aria-label="Today’s operational signals"><CommandSignal label="Attention" value={attentionCount} tone={attentionCount ? "attention" : "calm"} /><CommandSignal label="Scheduled" value={schedule.length} /><CommandSignal label="Due this week" value={dueThisWeek.length} tone={dueThisWeek.length ? "attention" : "calm"} /></div>
          <div className="flex items-center gap-2"><Link href="/bookings" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#e4e4df] bg-white px-3 text-sm font-medium text-[#4e5653] shadow-sm hover:bg-[#fafaf8]"><CalendarDays size={15} /> Calendar</Link><Link href="/bookings" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#263130] px-3 text-sm font-medium text-white hover:bg-[#394542]"><Plus size={16} /> New work</Link></div>
        </div>
      </section>

      <section className="dashboard-signal-strip grid grid-cols-2 gap-x-3 gap-y-2 xl:grid-cols-5">
        <Metric href="/shows" label="Active shows" value={String(activeShows.length)} detail={`${showRows.length} total shows`} icon={<Film size={15} />} />
        <Metric href="/shows" label="Episodes due" value={String(dueThisWeek.length)} detail="Next 7 days" icon={<Clock3 size={15} />} alert={dueThisWeek.length > 0} />
        <Metric href="/review" label="Locks awaiting sign-off" value={String(lockedCuts.length)} detail="Picture lock stage" icon={<CheckCircle2 size={15} />} />
        <Metric href="/shows" label="QC failures" value={String(qcFailures.length)} detail="Need attention" icon={<CircleAlert size={15} />} alert={qcFailures.length > 0} />
        <Metric href="/budget" label="Budget burn" value={budgetBurn === null ? "—" : `${budgetBurn}%`} detail={budget ? `${formatMoney(budget.totals.actual, currency)} actual` : "Restricted"} icon={<DollarSign size={15} />} alert={budgetBurn !== null && budgetBurn > 90} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.8fr)]">
        <div className="panel dashboard-timeline overflow-hidden">
          <SectionHeading title="Operational timeline" detail="What needs movement across the post floor" action="Open my work" href="/review" />
          <div className="dashboard-timeline__list">
            {operationalTimeline.map((item) => <TimelineItem key={item.id} item={item} />)}
            {!operationalTimeline.length && <EmptyRow label="The post floor is clear for now. New operational events will appear here." />}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <SectionHeading title="Capacity this week" detail="Suite use and artist load" action="Bookings" href="/bookings" />
            <div className="p-5">
              <div className="flex items-center justify-between"><p className="text-xs font-medium uppercase tracking-[0.08em] text-[#74807a]">Suite utilization</p><Gauge size={16} className="text-[#75827f]" /></div>
              <div className="mt-4 space-y-3">
                {suites.length ? suites.slice(0, 3).map(([suite, hours]) => {
                  const usage = Math.min(100, Math.round((hours / 40) * 100));
                  return <div key={suite}><div className="mb-1 flex justify-between text-xs"><span className="font-medium text-[#535a57]">{suite}</span><span className="text-[#858a87]">{hours.toFixed(0)}h · {usage}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${usage > 80 ? "bg-[#c17a4d]" : "bg-[#63877f]"}`} style={{ width: `${usage}%` }} /></div></div>;
                }) : <p className="text-sm text-[#858986]">No suite bookings this week.</p>}
              </div>
            </div>
            <div className="border-t border-[#ecebe7] px-5 py-4"><p className="text-xs font-medium uppercase tracking-[0.08em] text-[#74807a]">Artist workload</p><div className="mt-3 space-y-2.5">{workload.slice(0, 3).map((artist) => { const utilization = Math.min(100, Math.round((artist.hours / 40) * 100)); return <Link href="/team" key={artist.id} className="group flex items-center gap-2.5"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e5e8e4] text-[9px] font-bold text-[#59645f]">{artist.name.split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className="truncate text-xs font-medium text-[#3a403e] group-hover:text-[#315d51]">{artist.name}</p><span className="text-[11px] text-[#7f8582]">{artist.hours.toFixed(0)}h</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-[#ebeae6]"><div className="h-full rounded-full bg-[#66847e]" style={{ width: `${utilization}%` }} /></div></div></Link>; })}</div></div>
          </div>

          <SideSummary title="Budget health" description="Current estimate vs actual" className="p-0 [&_.pp-panel-header]:px-5 [&_.pp-panel-header]:pt-5">
          {budget ? <><div className="mt-6 flex items-end gap-3"><p className="text-3xl font-semibold tracking-[-0.05em] text-[#2f3533]">{budgetBurn}%</p><p className="pb-1 text-xs text-[#777e7b]">burned</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${(budgetBurn ?? 0) > 90 ? "bg-[#bd7650]" : "bg-[#64847e]"}`} style={{ width: `${Math.min(100, budgetBurn ?? 0)}%` }} /></div><dl className="mt-5 space-y-2.5 text-xs"><div className="flex justify-between"><dt className="text-[#7d827f]">Estimate</dt><dd className="font-medium text-[#464d4a]">{formatMoney(budget.totals.budgeted, currency)}</dd></div><div className="flex justify-between"><dt className="text-[#7d827f]">Actual</dt><dd className="font-medium text-[#464d4a]">{formatMoney(budget.totals.actual, currency)}</dd></div><div className="flex justify-between border-t border-[#ecebe7] pt-2.5"><dt className="text-[#7d827f]">Variance</dt><dd className={`font-semibold ${budget.totals.actual > budget.totals.budgeted ? "text-[#ac633f]" : "text-[#4d8068]"}`}>{formatMoney(budget.totals.actual - budget.totals.budgeted, currency)}</dd></div></dl></> : <p className="mt-6 rounded-lg bg-[#f5f7f5] px-3 py-4 text-sm leading-6 text-[#727a76]">Budget figures are available to users with commercial access.</p>}
          <Link href="/budget" className="mt-5 flex items-center gap-1 text-xs font-medium text-[#526d69] hover:text-[#314a45]">Open budget <ArrowRight size={13} /></Link>
          </SideSummary>
        </div>
      </section>
    </div>
  );
}

async function getCommandCenterData() {
  const response = await postpilotApiServerFetch<{
      metrics: { active_episodes: number; episodes_awaiting_sign_off: number; qc_attention: number; upcoming_deliveries: number };
      episodes: Array<{ id: string; title: string; number: number; qc_status: string; delivery_deadline: string | null; show_id: string; show_title: string; season_id: string; season_number: number; workflow_stage_key: string | null; workflow_status: string }>;
      shows: Array<{ id: string; title: string; code: string; seasons: Array<{ id: string; number: number }>; season_count: number; episode_count: number; active_episode_count: number }>;
      schedule: Array<{ id: string; title: string; starts_at: string; ends_at: string; room_name: string | null; person_name: string | null }>;
      team: Array<{ id: string; name: string; role: string }>;
      blocking_work_orders: Array<{ id: string; title: string; priority: string; status: string; due_at: string | null; episode_id: string; episode_title: string; episode_number: number; show_title: string; workflow_stage_name: string | null }>;
      budget: { budgeted: number; actual: number } | null;
      activity: Array<{ id: string; action: string; entity_type: string; entity_id: string; metadata: unknown; created_at: string }>;
    }>("/dashboard");
    const context = await getActiveOrganizationContext();
    const episodes = response.episodes.map((episode) => ({
      id: episode.id, title: episode.title, number: episode.number, qcStatus: episode.qc_status,
      deliveryDeadline: episode.delivery_deadline ? new Date(episode.delivery_deadline) : null,
      showId: episode.show_id, showTitle: episode.show_title, seasonId: episode.season_id,
      seasonNumber: episode.season_number, workflowStageKey: episode.workflow_stage_key,
      status: episode.workflow_status,
    }));
  return {
      organizationName: context?.organization?.organizationName ?? "Post house",
      dashboard: {
        metrics: { activeEpisodes: response.metrics.active_episodes, episodesInReview: response.metrics.episodes_awaiting_sign_off, qcAttention: response.metrics.qc_attention, upcomingDeliveries: response.metrics.upcoming_deliveries },
        episodes,
        activity: response.activity.map((item) => ({ id: item.id, action: item.action, entityType: item.entity_type, entityId: item.entity_id, metadata: item.metadata, createdAt: item.created_at })),
      },
      showRows: response.shows.map((show) => ({
        id: show.id, title: show.title, code: show.code,
        seasons: show.seasons.map((season) => {
          const seasonEpisodes = episodes.filter((episode) => episode.seasonId === season.id);
          return { id: season.id, number: season.number, episodeCount: seasonEpisodes.length, activeEpisodeCount: seasonEpisodes.filter((episode) => episode.status !== "complete").length };
        }),
      })),
      schedule: response.schedule.map((booking) => ({ ...booking, startsAt: new Date(booking.starts_at), endsAt: new Date(booking.ends_at), roomName: booking.room_name, personName: booking.person_name })),
      blockingWorkOrders: response.blocking_work_orders.map((workOrder) => ({ id: workOrder.id, title: workOrder.title, priority: workOrder.priority, status: workOrder.status, dueAt: workOrder.due_at ? new Date(workOrder.due_at) : null, episodeId: workOrder.episode_id, episodeTitle: workOrder.episode_title, episodeNumber: workOrder.episode_number, showTitle: workOrder.show_title, workflowStageName: workOrder.workflow_stage_name })),
      budget: response.budget ? { totals: { budgeted: response.budget.budgeted, actual: response.budget.actual } } : null,
      team: response.team,
      isDemo: false,
  };
}

function Metric({ href, label, value, detail, icon, alert = false }: { href: string; label: string; value: string; detail: string; icon: React.ReactNode; alert?: boolean }) {
  return <Link href={href} data-alert={alert} className="dashboard-signal min-w-0"><span className={`dashboard-signal__icon ${alert ? "dashboard-signal__icon--attention" : ""}`}>{icon}</span><span className="min-w-0"><span className="dashboard-signal__label">{label}</span><span className="mt-1 flex items-baseline gap-2"><strong>{value}</strong><small className={alert ? "text-[#a86843]" : ""}>{detail}</small></span></span></Link>;
}

function CommandSignal({ label, value, tone = "calm" }: { label: string; value: number; tone?: "calm" | "attention" }) {
  return <div className={`command-signal command-signal--${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function SectionHeading({ title, detail, action, href }: { title: string; detail: string; action: string; href: string }) {
  return <PanelHeader title={title} description={detail} action={<SectionAction href={href}>{action}</SectionAction>} />;
}

function EmptyRow({ label }: { label: string }) {
  return <div className="px-5 py-7 text-center text-sm text-[#858987]">{label}</div>;
}

function TimelineItem({ item }: { item: OperationalTimelineItem }) {
  return <Link href={item.href} className={`dashboard-timeline__item dashboard-timeline__item--${item.tone}`}><span className="dashboard-timeline__rail"><span className="dashboard-timeline__icon">{item.icon}</span></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6e7973]">{item.label}</span><time className="text-[11px] font-medium text-[#848c87]" dateTime={item.at?.toISOString()}>{item.at ? formatDate(item.at) : "Open"}</time></span><strong className="mt-1 block truncate text-sm font-semibold text-[#36403b]">{item.title}</strong><span className="mt-0.5 block truncate text-xs text-[#77817c]">{item.context}</span></span><ChevronRight className="mt-4 shrink-0 text-[#9aa29d]" size={15} /></Link>;
}
