import { WorkflowTemplateEditor } from "@/components/workflow-template-editor";
import Link from "next/link";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getTenantRolePolicies } from "@/lib/permissions";
import { getDefaultWorkflowConfig } from "@/server/data";
import { redirect } from "next/navigation";

export default async function WorkflowSettingsPage() {
  if (!(await can("manage_shows"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const [workflow, roles] = await Promise.all([getDefaultWorkflowConfig(context.organization.organizationId), getTenantRolePolicies(context.organization.organizationId)]);

  if (!workflow) {
    return <div className="panel mx-auto mt-16 max-w-xl p-8 text-center"><h1 className="text-lg font-semibold text-[#343b38]">No workflow configured</h1><p className="mt-2 text-sm text-[#747977]">Set up your organization workflow before configuring approvals.</p></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p>
        <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Post workflow</h1>
        <p className="mt-1 text-sm text-[#747977]">This is the single workflow used by your post house across its shows and episodes.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/settings/rooms" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Rooms & suites</Link><Link href="/settings/roles" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Roles & permissions</Link><Link href="/settings/catering" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Catering billing</Link></div>
      </header>
      <WorkflowTemplateEditor workflow={workflow} roles={roles} />
    </div>
  );
}
