import { FileCheck2 } from "lucide-react";
import { redirect } from "next/navigation";

import { WorkflowSignOffQueue } from "@/components/workflow-approval-queue";
import { WorkOrderQueue } from "@/components/work-order-queue";
import { getActiveOrganizationContext, getActiveShow } from "@/lib/organizations";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { roleHome } from "@/lib/permissions";

export default async function ApprovalsPage() {
  const [context, activeShow] = await Promise.all([
    getActiveOrganizationContext(),
    getActiveShow(),
  ]);
  const [signOffs, workOrders, hasApprovalAccess] = context?.organization
    ? await loadFastApprovalInbox()
    : [[], [], false];
  if (!hasApprovalAccess) redirect(await roleHome());
  const visibleSignOffs = activeShow ? signOffs.filter((item) => item.showId === activeShow.id) : signOffs;
  const visibleWorkOrders = activeShow ? workOrders.filter((item) => item.showId === activeShow.id) : workOrders;

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Approvals · {context?.organization?.organizationName ?? "No workspace"}</p>
          <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Approvals</h1>
          <p className="mt-1 text-sm text-[#747977]">Workflow gates awaiting sign-off and practical post work assigned to you.</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[#5e746c]"><FileCheck2 size={15} /> {visibleSignOffs.length} sign-offs · {visibleWorkOrders.length} work orders</span>
      </header>

      <WorkflowSignOffQueue signOffs={visibleSignOffs} />
      <WorkOrderQueue workOrders={visibleWorkOrders} canOpenEpisodes />
    </div>
  );
}

async function loadFastApprovalInbox() {
  const inbox = await postpilotApiServerFetch<{
    has_workspace: boolean;
    sign_offs: Array<{ id: string; approval_rule_id: string; episode_id: string; show_id: string; workflow_stage_id: string; stage_name: string; stage_position: number; sign_off_label: string; approver_role: string | null; approval_order: number; is_required: boolean; passed_at: string | null; show_title: string; episode_title: string; episode_number: number }>;
    work_orders: Array<{ id: string; episode_id: string; show_id: string; show_title: string; episode_title: string; episode_number: number; workflow_stage_name: string | null; kind: string; title: string; description: string | null; priority: string; is_blocking: boolean; status: string; due_at: string | null; external_url: string | null; workflow_state: { display_status: string; primary_stage_name: string | null } | null }>;
  }>("/approvals");
  return [
    inbox.sign_offs.map((item) => ({ id: item.id, approvalRuleId: item.approval_rule_id, episodeId: item.episode_id, showId: item.show_id, workflowStageId: item.workflow_stage_id, stageName: item.stage_name, stagePosition: item.stage_position, signOffLabel: item.sign_off_label, approverRole: item.approver_role, approvalOrder: item.approval_order, isRequired: item.is_required, passedAt: item.passed_at ? new Date(item.passed_at) : null, showTitle: item.show_title, episodeTitle: item.episode_title, episodeNumber: item.episode_number })),
    inbox.work_orders.map((item) => ({ id: item.id, episodeId: item.episode_id, showId: item.show_id, showTitle: item.show_title, episodeTitle: item.episode_title, episodeNumber: item.episode_number, workflowStageName: item.workflow_stage_name, kind: item.kind, title: item.title, description: item.description, priority: item.priority, isBlocking: item.is_blocking, status: item.status, dueAt: item.due_at ? new Date(item.due_at) : null, externalUrl: item.external_url, workflowState: item.workflow_state ? { displayStatus: item.workflow_state.display_status, primaryStageName: item.workflow_state.primary_stage_name } : null })),
    inbox.has_workspace,
  ] as const;
}
