import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { notFound } from "next/navigation";

import { EpisodeDetailTabs } from "@/components/episode-detail-tabs";
import { EpisodeEditButton } from "@/components/episode-edit-button";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getDemoCommandCenterData, getEpisodeWorkspace } from "@/server/data";

export default async function EpisodeDetailPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const data = await getEpisodeDetail(episodeId);
  if (!data) notFound();
  const { episode } = data;
  const [canManageWorkOrders, canUpdateWorkOrders, canManageCommercial, canManageShows, canManageQc, canWaiveQc] = await Promise.all([can("manage_work_orders"), can("update_assigned_work"), can("manage_budget"), can("manage_shows"), can("manage_qc"), can("waive_qc")]);
  return <div className="space-y-5"><Link href="/episodes" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All episodes</Link><header className="panel flex justify-between gap-4 p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{episode.showTitle} · S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{episode.title}</h1><p className="mt-1 text-sm capitalize text-[#777d79]">{episode.workflowStage ?? episode.status.replaceAll("_", " ")} · {episode.qcStatus.replaceAll("_", " ")}</p></div></div>{canManageShows && <EpisodeEditButton episode={episode} />}</header><EpisodeDetailTabs data={data} canManageWorkOrders={canManageWorkOrders} canUpdateWorkOrders={canUpdateWorkOrders} canManageCommercial={canManageCommercial} canManageQc={canManageQc} canWaiveQc={canWaiveQc} /></div>;
}

async function getEpisodeDetail(episodeId: string) {
  if (isDebugDemoMode) {
    const demo = getDemoCommandCenterData(); const episode = demo.dashboard.episodes.find((item) => item.id === episodeId); if (!episode) return null;
    const details = { ...episode, workflowStageId: null, workflowStage: null, editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu", producerName: episode.showTitle === "Under Current" ? "Noah Chen" : "Maya Ortiz", productionCode: null, airDate: null, lockedCutDate: null };
    const workflowApprovers = [...demo.team.map((person) => ({ id: person.id, name: person.name, role: person.role })), { id: "demo-director", name: "Mara Voss", role: "director" }, { id: "demo-network", name: "Iris Bell", role: "network" }];
    return { episode: details, schedule: demo.schedule.filter((item) => item.episodeTitle === episode.title), budget: [{ id: "demo-budget", category: "Editorial + finishing", actualAmount: "42150.00", budgetedAmount: "48000.00" }], activity: demo.dashboard.activity.filter((item) => item.entityId === episode.id), workflowStages: [], workflowApprovalRules: [], workflowApprovals: [], workflowApprovers, episodeTeam: [], workOrders: [], qcHistory: [], qcIssueHistory: [], vendorOptions: [], clientPos: [], vendorPos: [] };
  }
  const context = await getActiveOrganizationContext();
  return context?.organization ? getEpisodeWorkspace(context.organization.organizationId, episodeId) : null;
}
