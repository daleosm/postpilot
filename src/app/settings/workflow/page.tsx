import { WorkflowTemplateEditor } from "@/components/workflow-template-editor";
import Link from "next/link";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, canManageWorkflowConfiguration } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { redirect } from "next/navigation";

export default async function WorkflowSettingsPage() {
  if (!(await canManageWorkflowConfiguration())) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const [workflowBootstrap, mayManageUsers, mayManageDeliveryProfiles] = await Promise.all([
    postpilotApiServerFetch<{ policies: Array<{ role: string; label: string }>; workflow: { id: string; name: string; description: string | null; stages: Array<{ id: string; name: string; key: string; position: number; color: string; is_terminal: boolean; can_start_early: boolean; requires_qc_pass: boolean; delivery_gate: "none" | "facility_dispatch" | "client_acceptance" }>; rules: Array<{ id: string; workflow_stage_id: string; approver_role: string | null; label: string; approval_order: number; is_required: boolean }>; work_order_templates: Array<{ id: string; workflow_stage_id: string; title: string; description: string | null; department: string | null; assignee_role: string | null; priority: "blocker" | "high" | "normal" | "low"; is_blocking: boolean; position: number }> } | null }>("/settings/bootstrap"),
    can("manage_users"),
    can("manage_delivery_profiles"),
  ]);

  const workflow = workflowBootstrap.workflow ? ({ id: workflowBootstrap.workflow.id, name: workflowBootstrap.workflow.name, description: workflowBootstrap.workflow.description, stages: workflowBootstrap.workflow.stages.map((stage) => ({ id: stage.id, name: stage.name, key: stage.key, position: stage.position, color: stage.color, isTerminal: stage.is_terminal, canStartEarly: stage.can_start_early, requiresQcPass: stage.requires_qc_pass, deliveryGate: stage.delivery_gate })), rules: workflowBootstrap.workflow.rules.map((rule) => ({ id: rule.id, workflowStageId: rule.workflow_stage_id, approverRole: rule.approver_role, label: rule.label, approvalOrder: rule.approval_order, isRequired: rule.is_required })), workOrderTemplates: workflowBootstrap.workflow.work_order_templates.map((template) => ({ id: template.id, workflowStageId: template.workflow_stage_id, title: template.title, description: template.description, department: template.department, assigneeRole: template.assignee_role, priority: template.priority, isBlocking: template.is_blocking, position: template.position })) }) : null;

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
        <div className="flex flex-wrap gap-2"><Link href="/settings/rooms" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Rooms & suites</Link><Link href="/settings/roles" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Roles & permissions</Link>{mayManageUsers && <Link href="/settings/users" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Users & access</Link>}{mayManageDeliveryProfiles && <Link href="/settings/delivery-profiles" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Delivery profiles</Link>}<Link href="/settings/sso" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Microsoft SSO</Link><Link href="/settings/currency" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Currency</Link><Link href="/settings/work-order-time" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Work-order time</Link><Link href="/settings/invoicing" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Invoicing</Link><Link href="/settings/catering" className="rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs font-semibold text-[#45685e] hover:bg-[#f3f7f4]">Catering billing</Link></div>
      </header>
      <WorkflowTemplateEditor workflow={workflow} roles={workflowBootstrap.policies.map((policy) => ({ role: policy.role, label: policy.label }))} />
    </div>
  );
}
