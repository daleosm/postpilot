import { FileCheck2 } from "lucide-react";
import { redirect } from "next/navigation";

import { WorkflowSignOffQueue } from "@/components/workflow-approval-queue";
import { getActiveOrganizationContext, getActiveShow } from "@/lib/organizations";
import { can, getCurrentPerson, roleHome } from "@/lib/permissions";
import { listWorkflowSignOffInbox } from "@/server/data";

export default async function ApprovalsPage() {
  const [mayManage, mayApprove, person, context, activeShow] = await Promise.all([
    can("manage_reviews"),
    can("approve_reviews"),
    getCurrentPerson(),
    getActiveOrganizationContext(),
    getActiveShow(),
  ]);
  if (!(mayManage || mayApprove)) redirect(roleHome(person?.role));

  const signOffs = context?.organization ? await listWorkflowSignOffInbox(context.organization.organizationId, context.userId) : [];
  const visibleSignOffs = activeShow ? signOffs.filter((item) => item.showId === activeShow.id) : signOffs;

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Approvals · {context?.organization?.organizationName ?? "No workspace"}</p>
          <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Approvals</h1>
          <p className="mt-1 text-sm text-[#747977]">Workflow stages awaiting the next configured sign-off.</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[#5e746c]"><FileCheck2 size={15} /> {visibleSignOffs.length} awaiting sign-off</span>
      </header>

      <WorkflowSignOffQueue signOffs={visibleSignOffs} canOpenEpisodes={mayManage} />
    </div>
  );
}
