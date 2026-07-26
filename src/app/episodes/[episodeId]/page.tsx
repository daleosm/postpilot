import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { notFound } from "next/navigation";

import { EpisodeDetailTabs } from "@/components/episode-detail-tabs";
import { EpisodeEditButton } from "@/components/episode-edit-button";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, canSignOffWorkflowTrack, canSubmitWorkflowTrack, canUpdateWorkflowWork, isAssignedToEpisode } from "@/lib/permissions";
import { PostPilotApiServerError, postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function EpisodeDetailPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const [organizationContext, canManageShows] = await Promise.all([getActiveOrganizationContext(), can("manage_shows")]);
  const data = await getEpisodeDetail(episodeId);
  if (!data) notFound();
  const assignedToEpisode = await isAssignedToEpisode(episodeId);
  const currentPersonId = organizationContext?.person?.id ?? null;
  const isClient = organizationContext?.organization?.role === "client";
  const canSeeAllEpisodes = canManageShows && !isClient;
  if (!canSeeAllEpisodes && !assignedToEpisode) notFound();
  const { episode } = data;
  const [canManageWorkOrders, canApproveWorkOrders, canUpdateWorkOrders, canManageCommercial, canManageQc, canVerifyQc, canWaiveQc, canAuthorizeWorkflowExceptions, mayUpdateWorkflowWork, maySubmitWorkflowTracks, maySignOffWorkflowTracks, canManageDelivery, canUpdateDelivery, canConfirmDeliveryReceipt] = await Promise.all([can("manage_work_orders"), can("approve_work_orders"), can("update_assigned_work"), can("manage_budget"), can("manage_qc"), can("verify_qc"), can("waive_qc"), can("authorize_early_starts"), canUpdateWorkflowWork(episodeId), canSubmitWorkflowTrack(episodeId), canSignOffWorkflowTrack(episodeId), can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt")]);
  const canViewDelivery = isClient || canManageDelivery || canUpdateDelivery || canConfirmDeliveryReceipt;
  const visibleData = canManageCommercial || isClient ? data : {
    ...data,
    budget: [],
    workOrders: data.workOrders.map((workOrder) => ({ ...workOrder, billingScope: "included", billingStatus: "not_billable", estimatedAmount: null, clientQuoteAmount: null, actualAmount: null, currency: "", clientQuoteCurrency: null, billingNotes: null, budgetLineId: null })),
  };
  const safeVisibleData = canViewDelivery ? visibleData : { ...visibleData, deliveryManifest: null };
  const episodeData = safeVisibleData;
  return <div className="space-y-5"><Link href="/shows" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All shows</Link><header className="panel flex justify-between gap-4 p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{episode.showTitle} · S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{episode.title}</h1><div className="mt-2 flex flex-wrap items-center gap-2"><p className="text-sm text-[#64716b]">{episode.workflowStage ?? "Workflow not configured"}</p><WorkflowStateBadge status={episode.workflowState?.displayStatus ?? episode.status} /><span className="text-xs text-[#8a918d]">QC · {episode.qcStatus.replaceAll("_", " ")}</span></div></div></div>{canSeeAllEpisodes && <EpisodeEditButton episode={episode as unknown as React.ComponentProps<typeof EpisodeEditButton>["episode"]} />}</header><EpisodeDetailTabs data={episodeData} canUpdateWorkflowWork={mayUpdateWorkflowWork} canSubmitWorkflowTracks={maySubmitWorkflowTracks} canSignOffWorkflowTracks={maySignOffWorkflowTracks} canAuthorizeWorkflowExceptions={canAuthorizeWorkflowExceptions} canManageWorkOrders={canManageWorkOrders} canApproveWorkOrders={canApproveWorkOrders} canUpdateWorkOrders={canUpdateWorkOrders} canManageCommercial={canManageCommercial} canViewCommercial={canManageCommercial || isClient} canManageQc={canManageQc} canVerifyQc={canVerifyQc} canWaiveQc={canWaiveQc} canViewDelivery={canViewDelivery} canManageDelivery={canManageDelivery} canUpdateDelivery={canUpdateDelivery} canConfirmDeliveryReceipt={canConfirmDeliveryReceipt} currentPersonId={currentPersonId} /></div>;
}

async function getEpisodeDetail(episodeId: string) {
  try {
    return camelize(await postpilotApiServerFetch(`/episodes/${episodeId}/workspace`)) as React.ComponentProps<typeof EpisodeDetailTabs>["data"];
  } catch (error) {
    // Only an explicit FastAPI not-found response represents a missing or
    // inaccessible episode. Everything else reaches the error boundary.
    if (error instanceof PostPilotApiServerError && error.status === 404) return null;
    throw error;
  }
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), camelize(child)]));
}
