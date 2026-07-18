import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { notFound } from "next/navigation";

import { EpisodeDetailTabs } from "@/components/episode-detail-tabs";
import { EpisodeEditButton } from "@/components/episode-edit-button";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, isAssignedToEpisode } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getDemoCommandCenterData, getEpisodeWorkspace } from "@/server/data";
import { DeliveryManifestError, getActiveSharedDeliveryManifest } from "@/server/delivery-manifests";

export default async function EpisodeDetailPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const [organizationContext, canManageShows] = await Promise.all([getActiveOrganizationContext(), can("manage_shows")]);
  if (!isDebugDemoMode && organizationContext?.organization?.role === "guest") {
    let manifest: Awaited<ReturnType<typeof getActiveSharedDeliveryManifest>>;
    try {
      manifest = await getActiveSharedDeliveryManifest(episodeId);
    } catch (error) {
      if (error instanceof DeliveryManifestError && error.status < 500) notFound();
      throw error;
    }
    return <SharedDeliveryManifest manifest={manifest} />;
  }
  const canSeeAllEpisodes = canManageShows && organizationContext?.organization?.role !== "guest";
  if (!isDebugDemoMode && !canSeeAllEpisodes && !(await isAssignedToEpisode(episodeId))) notFound();
  const data = await getEpisodeDetail(episodeId);
  if (!data) notFound();
  const { episode } = data;
  const [canManageWorkOrders, canApproveWorkOrders, canUpdateWorkOrders, canManageCommercial, canManageQc, canVerifyQc, canWaiveQc, canManageDelivery, canUpdateDelivery, canConfirmDeliveryReceipt] = await Promise.all([can("manage_work_orders"), can("approve_work_orders"), can("update_assigned_work"), can("manage_budget"), can("manage_qc"), can("verify_qc"), can("waive_qc"), can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt")]);
  const canViewDelivery = canManageDelivery || canUpdateDelivery || canConfirmDeliveryReceipt;
  const visibleData = canManageCommercial ? data : {
    ...data,
    budget: [],
    workOrders: data.workOrders.map((workOrder) => ({ ...workOrder, billingScope: "included", billingStatus: "not_billable", estimatedAmount: null, clientQuoteAmount: null, actualAmount: null, currency: "", clientQuoteCurrency: null, billingNotes: null, budgetLineId: null })),
  };
  const safeVisibleData = canViewDelivery ? visibleData : { ...visibleData, deliveryManifest: null };
  return <div className="space-y-5"><Link href="/episodes" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All episodes</Link><header className="panel flex justify-between gap-4 p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{episode.showTitle} · S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{episode.title}</h1><p className="mt-1 text-sm capitalize text-[#777d79]">{episode.workflowStage ?? episode.status.replaceAll("_", " ")} · {episode.qcStatus.replaceAll("_", " ")}</p></div></div>{canSeeAllEpisodes && <EpisodeEditButton episode={episode} />}</header><EpisodeDetailTabs data={safeVisibleData} canManageEpisodes={canSeeAllEpisodes} canManageWorkOrders={canManageWorkOrders} canApproveWorkOrders={canApproveWorkOrders} canUpdateWorkOrders={canUpdateWorkOrders} canManageCommercial={canManageCommercial} canManageQc={canManageQc} canVerifyQc={canVerifyQc} canWaiveQc={canWaiveQc} canViewDelivery={canViewDelivery} canManageDelivery={canManageDelivery} canUpdateDelivery={canUpdateDelivery} canConfirmDeliveryReceipt={canConfirmDeliveryReceipt} currentPersonId={organizationContext?.person?.id ?? null} /></div>;
}

function SharedDeliveryManifest({ manifest }: { manifest: Awaited<ReturnType<typeof getActiveSharedDeliveryManifest>> }) {
  return <div className="mx-auto max-w-4xl space-y-5"><header className="panel p-6"><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">Shared delivery status</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{manifest.profileName}</h1><p className="mt-2 text-sm text-[#6f7773]">Only delivery status and references your post house has shared are shown here.</p></header><section className="panel overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-[#e7e8e4] bg-[#fafbf9] text-xs uppercase tracking-[0.08em] text-[#78807b]"><tr><th className="px-4 py-3">Component</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Reference</th></tr></thead><tbody className="divide-y divide-[#efefeb]">{manifest.items.map((item) => <tr key={item.id}><td className="px-4 py-3"><p className="font-medium text-[#35403b]">{item.label}</p><p className="mt-0.5 text-xs text-[#7a827e]">{[item.version, item.territory, item.language].filter(Boolean).join(" · ") || item.componentType}</p></td><td className="px-4 py-3 capitalize text-[#50645c]">{item.status.replaceAll("_", " ")}</td><td className="px-4 py-3 text-[#66706b]">{item.dueDate ? new Date(item.dueDate).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "—"}</td><td className="px-4 py-3">{item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer" className="font-medium text-[#47756a] underline underline-offset-2">{item.externalReference || "Open reference"}</a> : item.externalReference ? <span className="text-[#66706b]">{item.externalReference}</span> : <span className="text-[#8a918d]">Not shared</span>}</td></tr>)}</tbody></table></div></section></div>;
}

async function getEpisodeDetail(episodeId: string) {
  if (isDebugDemoMode) {
    const demo = getDemoCommandCenterData(); const episode = demo.dashboard.episodes.find((item) => item.id === episodeId); if (!episode) return null;
    const details = { ...episode, workflowStageId: null, workflowStage: null, editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu", producerName: episode.showTitle === "Under Current" ? "Noah Chen" : "Maya Ortiz", productionCode: null, airDate: null, lockedCutDate: null };
    const workflowApprovers = [...demo.team.map((person) => ({ id: person.id, name: person.name, role: person.role })), { id: "demo-director", name: "Mara Voss", role: "director" }, { id: "demo-network", name: "Iris Bell", role: "network" }];
    return { episode: details, schedule: demo.schedule.filter((item) => item.episodeTitle === episode.title), budget: [{ id: "demo-budget", category: "Editorial + finishing", actualAmount: "42150.00", budgetedAmount: "48000.00" }], activity: demo.dashboard.activity.filter((item) => item.entityId === episode.id), workflowStages: [], workflowApprovalRules: [], workflowApprovals: [], workflowTracks: [], workflowApprovers, episodeTeam: [], workOrders: [], qcHistory: [], qcIssueHistory: [], vendorOptions: [], deliveryManifest: null, deliveryProfiles: [] };
  }
  const context = await getActiveOrganizationContext();
  return context?.organization ? getEpisodeWorkspace(context.organization.organizationId, episodeId) : null;
}
