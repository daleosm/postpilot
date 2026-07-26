import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { notFound } from "next/navigation";

import { EpisodeDetailTabs } from "@/components/episode-detail-tabs";
import { EpisodeEditButton } from "@/components/episode-edit-button";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, canSignOffWorkflowTrack, canSubmitWorkflowTrack, canUpdateWorkflowWork, isAssignedToEpisode } from "@/lib/permissions";
import { PostPilotApiServerError, postpilotApiServerFetch } from "@/lib/postpilot-api-server";

type SharedDeliveryManifest = {
  profileName: string;
  items: Array<{ id: string; label: string; version: string | null; territory: string | null; language: string | null; componentType: string; status: string; dueDate: string | null; externalUrl: string | null; externalReference: string | null }>;
};

export default async function EpisodeDetailPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const [organizationContext, canManageShows] = await Promise.all([getActiveOrganizationContext(), can("manage_shows")]);
  const data = await getEpisodeDetail(episodeId);
  if (!data) notFound();
  const assignedToEpisode = await isAssignedToEpisode(episodeId);
  const currentPersonId = organizationContext?.person?.id ?? null;
  if (organizationContext?.organization?.role === "client") {
    let sharedManifest: SharedDeliveryManifest | null = null;
    try {
      sharedManifest = camelize(await postpilotApiServerFetch(`/episodes/${episodeId}/delivery-manifest/shared`)) as SharedDeliveryManifest;
    } catch (error) {
      // A selected episode-team signer may still use the tightly scoped
      // workflow workspace without being granted delivery-manifest access.
      const expectedAccessError =
        error instanceof PostPilotApiServerError && error.status < 500;
      if (!expectedAccessError) throw error;
      if (!assignedToEpisode) notFound();
    }
    if (sharedManifest) return <SharedDeliveryManifest manifest={sharedManifest} />;
  }
  const canSeeAllEpisodes = canManageShows && organizationContext?.organization?.role !== "client";
  if (!canSeeAllEpisodes && !assignedToEpisode) notFound();
  const { episode } = data;
  const [canManageWorkOrders, canApproveWorkOrders, canUpdateWorkOrders, canManageCommercial, canManageQc, canVerifyQc, canWaiveQc, canAuthorizeWorkflowExceptions, mayUpdateWorkflowWork, maySubmitWorkflowTracks, maySignOffWorkflowTracks, canManageDelivery, canUpdateDelivery, canConfirmDeliveryReceipt] = await Promise.all([can("manage_work_orders"), can("approve_work_orders"), can("update_assigned_work"), can("manage_budget"), can("manage_qc"), can("verify_qc"), can("waive_qc"), can("authorize_early_starts"), canUpdateWorkflowWork(episodeId), canSubmitWorkflowTrack(episodeId), canSignOffWorkflowTrack(episodeId), can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt")]);
  const canViewDelivery = canManageDelivery || canUpdateDelivery || canConfirmDeliveryReceipt;
  const visibleData = canManageCommercial ? data : {
    ...data,
    budget: [],
    workOrders: data.workOrders.map((workOrder) => ({ ...workOrder, billingScope: "included", billingStatus: "not_billable", estimatedAmount: null, clientQuoteAmount: null, actualAmount: null, currency: "", clientQuoteCurrency: null, billingNotes: null, budgetLineId: null })),
  };
  const safeVisibleData = canViewDelivery ? visibleData : { ...visibleData, deliveryManifest: null };
  const guestWorkflowOnly = organizationContext?.organization?.role === "client";
  const episodeData = guestWorkflowOnly ? { ...safeVisibleData, schedule: [], budget: [], activity: [], workOrders: [], qcHistory: [], qcIssueHistory: [], vendorOptions: [], deliveryManifest: null, deliveryProfiles: [] } : safeVisibleData;
  return <div className="space-y-5"><Link href="/shows" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All shows</Link><header className="panel flex justify-between gap-4 p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{episode.showTitle} · S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{episode.title}</h1><div className="mt-2 flex flex-wrap items-center gap-2"><p className="text-sm text-[#64716b]">{episode.workflowStage ?? "Workflow not configured"}</p><WorkflowStateBadge status={episode.workflowState?.displayStatus ?? episode.status} /><span className="text-xs text-[#8a918d]">QC · {episode.qcStatus.replaceAll("_", " ")}</span></div></div></div>{canSeeAllEpisodes && <EpisodeEditButton episode={episode as unknown as React.ComponentProps<typeof EpisodeEditButton>["episode"]} />}</header><EpisodeDetailTabs data={episodeData} workflowOnly={guestWorkflowOnly} canUpdateWorkflowWork={mayUpdateWorkflowWork} canSubmitWorkflowTracks={maySubmitWorkflowTracks} canSignOffWorkflowTracks={maySignOffWorkflowTracks} canAuthorizeWorkflowExceptions={canAuthorizeWorkflowExceptions} canManageWorkOrders={canManageWorkOrders} canApproveWorkOrders={canApproveWorkOrders} canUpdateWorkOrders={canUpdateWorkOrders} canManageCommercial={canManageCommercial} canManageQc={canManageQc} canVerifyQc={canVerifyQc} canWaiveQc={canWaiveQc} canViewDelivery={canViewDelivery} canManageDelivery={canManageDelivery} canUpdateDelivery={canUpdateDelivery} canConfirmDeliveryReceipt={canConfirmDeliveryReceipt} currentPersonId={currentPersonId} /></div>;
}

function SharedDeliveryManifest({ manifest }: { manifest: SharedDeliveryManifest }) {
  return <div className="mx-auto max-w-4xl space-y-5"><header className="panel p-6"><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">Shared delivery status</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{manifest.profileName}</h1><p className="mt-2 text-sm text-[#6f7773]">Only delivery status and references your post house has shared are shown here.</p></header><section className="panel overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-[#e7e8e4] bg-[#fafbf9] text-xs uppercase tracking-[0.08em] text-[#78807b]"><tr><th className="px-4 py-3">Component</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Reference</th></tr></thead><tbody className="divide-y divide-[#efefeb]">{manifest.items.map((item) => <tr key={item.id}><td className="px-4 py-3"><p className="font-medium text-[#35403b]">{item.label}</p><p className="mt-0.5 text-xs text-[#7a827e]">{[item.version, item.territory, item.language].filter(Boolean).join(" · ") || item.componentType}</p></td><td className="px-4 py-3 capitalize text-[#50645c]">{item.status.replaceAll("_", " ")}</td><td className="px-4 py-3 text-[#66706b]">{item.dueDate ? new Date(item.dueDate).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "—"}</td><td className="px-4 py-3">{item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer" className="font-medium text-[#47756a] underline underline-offset-2">{item.externalReference || "Open reference"}</a> : item.externalReference ? <span className="text-[#66706b]">{item.externalReference}</span> : <span className="text-[#8a918d]">Not shared</span>}</td></tr>)}</tbody></table></div></section></div>;
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
