import { FileCheck2 } from "lucide-react";
import { redirect } from "next/navigation";

import { WorkflowSignOffQueue } from "@/components/workflow-approval-queue";
import { WorkOrderQueue } from "@/components/work-order-queue";
import { getActiveOrganizationContext, getActiveShow } from "@/lib/organizations";
import { roleHome } from "@/lib/permissions";
import { hasApprovalWorkspace, listWorkOrderInbox, listWorkflowSignOffInbox } from "@/server/data";

export default async function ApprovalsPage() {
  const [context, activeShow] = await Promise.all([
    getActiveOrganizationContext(),
    getActiveShow(),
  ]);
  const [signOffs, workOrders, hasApprovalAccess] = context?.organization ? await Promise.all([listWorkflowSignOffInbox(context.organization.organizationId, context.userId), listWorkOrderInbox(context.organization.organizationId, context.userId), hasApprovalWorkspace(context.organization.organizationId, context.userId)]) : [[], [], false];
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
