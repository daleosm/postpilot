import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { UserAccessManager } from "@/components/user-access-manager";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function UserSettingsPage() {
  if (!(await can("manage_users"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const data = await postpilotApiServerFetch<{ users: Array<{ user_id: string; user_name: string | null; email: string; membership_role: "owner" | "admin" | "member" | "client"; joined_at: string | null; person_id: string | null; person_name: string | null; person_role: string | null; is_active: boolean | null }>; policies: Array<{ role: string; label: string }> }>("/settings/bootstrap").then((data) => ({ users: data.users.map((user) => ({ userId: user.user_id, userName: user.user_name, email: user.email, membershipRole: user.membership_role, joinedAt: user.joined_at ? new Date(user.joined_at) : new Date(), personId: user.person_id, personName: user.person_name, personRole: user.person_role, isActive: user.is_active })), policies: data.policies }));
  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Users & access</h1><p className="mt-1 max-w-2xl text-sm text-[#747977]">Add internal staff, freelancers, or client reviewers to this post house. Their role determines the permissions configured for this tenant.</p></header><UserAccessManager users={data.users} policies={data.policies.map(({ role, label }) => ({ role, label }))} /></div>;
}
