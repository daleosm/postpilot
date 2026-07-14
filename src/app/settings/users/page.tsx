import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { UserAccessManager } from "@/components/user-access-manager";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getTenantRolePolicies } from "@/lib/permissions";
import { listOrganizationUsers } from "@/server/data";

export default async function UserSettingsPage() {
  if (!(await can("manage_users"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const [users, policies] = await Promise.all([listOrganizationUsers(context.organization.organizationId), getTenantRolePolicies(context.organization.organizationId)]);
  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Users & access</h1><p className="mt-1 max-w-2xl text-sm text-[#747977]">Add internal staff, freelancers, or client reviewers to this post house. Their role determines the permissions configured for this tenant.</p></header><UserAccessManager users={users} policies={policies.map(({ role, label }) => ({ role, label }))} /></div>;
}
