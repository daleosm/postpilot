import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { EpisodeDetailTabs } from "@/components/episode-detail-tabs";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { defaultEpisodicApprovalRules, defaultEpisodicWorkflow, defaultWorkflowStageForStatus } from "@/lib/workflow";
import { getDemoCommandCenterData, getEpisodeWorkspace } from "@/server/data";

export default async function EpisodeDetailPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const data = await getEpisodeDetail(episodeId);
  if (!data) notFound();
  const { episode } = data;
  return <div className="space-y-5"><Link href="/episodes" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All episodes</Link><header className="panel p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{episode.showTitle} · S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{episode.title}</h1><p className="mt-1 text-sm capitalize text-[#777d79]">{episode.workflowStage ?? episode.status.replaceAll("_", " ")} · {episode.qcStatus.replaceAll("_", " ")}</p></div></div></header><EpisodeDetailTabs data={data} /></div>;
}

async function getEpisodeDetail(episodeId: string) {
  if (isDebugDemoMode) {
    const demo = getDemoCommandCenterData(); const episode = demo.dashboard.episodes.find((item) => item.id === episodeId); if (!episode) return null;
    const cookieStore = await cookies(); const stored = cookieStore.get("postpilot.debugEpisodeWorkflows")?.value; let updates: Record<string, string> = {}; try { updates = JSON.parse(stored ? decodeURIComponent(stored) : "{}"); } catch { updates = {}; }
    const stage = defaultEpisodicWorkflow.find((item) => item.id === updates[episodeId]) ?? defaultWorkflowStageForStatus(episode.status);
    const details = { ...episode, workflowStageId: stage.id, workflowStage: stage.name, editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu", producerName: episode.showTitle === "Under Current" ? "Noah Chen" : "Maya Ortiz", lockedCutDate: null };
    const storedApprovals = cookieStore.get("postpilot.debugWorkflowApprovals")?.value; let approvalState: Record<string, Record<string, Record<string, "pending" | "approved" | "changes_requested">>> = {}; try { approvalState = JSON.parse(storedApprovals ? decodeURIComponent(storedApprovals) : "{}"); } catch { approvalState = {}; }
    const workflowApprovals = Object.entries(approvalState[episodeId] ?? {}).flatMap(([workflowStageId, ruleStatuses]) => Object.entries(ruleStatuses).map(([approvalRuleId, status]) => { const rule = defaultEpisodicApprovalRules.find((item) => item.id === approvalRuleId)!; return { id: `debug-approval-${approvalRuleId}`, workflowStageId, approvalRuleId, approverRole: rule.approverRole, requiredPersonId: null, status, comment: null, submittedAt: new Date(), respondedAt: status === "pending" ? null : new Date() }; }));
    const workflowApprovers = [...demo.team.map((person) => ({ id: person.id, name: person.name, role: person.role })), { id: "demo-director", name: "Mara Voss", role: "director" }, { id: "demo-network", name: "Iris Bell", role: "network" }];
    return { episode: details, schedule: demo.schedule.filter((item) => item.episodeTitle === episode.title), reviews: [{ id: "demo-review", title: `${episode.title} director’s cut`, version: 3, status: "in_review", submittedAt: new Date(), dueAt: episode.deliveryDeadline }], deliverables: demo.deliverables.filter((item) => item.episodeTitle === episode.title), budget: [{ id: "demo-budget", category: "Editorial + finishing", actualAmount: "42150.00", budgetedAmount: "48000.00" }], activity: demo.dashboard.activity, workflowStages: defaultEpisodicWorkflow, workflowApprovalRules: defaultEpisodicApprovalRules, workflowApprovals, workflowApprovers };
  }
  const context = await getActiveOrganizationContext();
  return context?.organization ? getEpisodeWorkspace(context.organization.organizationId, episodeId) : null;
}
