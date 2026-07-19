import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { RolePolicyEditor } from "@/components/role-policy-editor";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getTenantRolePolicies, permissions } from "@/lib/permissions";

export default async function RoleSettingsPage() {
  if (!(await can("manage_users"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const policies = await getTenantRolePolicies(context.organization.organizationId);
  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Post workflow</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Roles & permissions</h1><p className="mt-1 text-sm text-[#747977]">Start with PostPilot’s defaults, then set the permissions your post house wants each role to have.</p></header><RolePolicyEditor initialPolicies={policies} permissions={permissions} /></div>;
}
