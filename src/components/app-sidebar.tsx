import Link from "next/link";
import {
  Building2,
  CalendarRange,
  Clock3,
  Coffee,
  Clapperboard,
  DollarSign,
  FileCheck2,
  House,
  Settings,
  Truck,
  UsersRound,
} from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getCurrentPerson } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

const navigation = [
  { label: "Dashboard", icon: House, href: "/" },
  { label: "Shows", icon: Clapperboard, href: "/shows", permissions: ["manage_shows", "view_all_operations"] },
  { label: "Bookings", icon: CalendarRange, href: "/bookings", permissions: ["manage_bookings", "view_all_operations"] },
  { label: "My time", icon: Clock3, href: "/my-time", permissions: ["update_assigned_work"] },
  { label: "Catering", icon: Coffee, href: "/catering", permissions: ["request_catering"] },
  { label: "Runner desk", icon: Coffee, href: "/runner", permissions: ["manage_catering"] },
  { label: "Budget", icon: DollarSign, href: "/budget", permissions: ["manage_budget"] },
  { label: "Deliveries", icon: Truck, href: "/deliveries", permissions: ["manage_episode_manifests", "update_delivery_items", "confirm_delivery_receipt"] },
  { label: "Clients & vendors", icon: Building2, href: "/crm", permissions: ["manage_shows", "manage_budget"] },
  { label: "Team", icon: UsersRound, href: "/team", permissions: ["manage_shows"] },
];

export async function AppSidebar() {
  const [person, context, mayManageUsers, mayManageWorkflowConfiguration, mayManageDeliveryProfiles, permitted] = await Promise.all([
    getCurrentPerson(),
    getActiveOrganizationContext(),
    can("manage_users"),
    can("manage_workflow_configuration"),
    can("manage_delivery_profiles"),
    Promise.all(
      navigation.map(async (item) =>
        !item.permissions || (await Promise.all(item.permissions.map((permission) => can(permission)))).some(Boolean)
          ? item
          : null,
      ),
    ),
  ]);
  const [pending, hasApprovalAccess] = await (context?.organization && context.person
    ? loadFastApprovalSummary()
    : Promise.resolve([0, false] as [number, boolean]));
  const visible = permitted.filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (hasApprovalAccess) visible.push({ label: "Approvals", icon: FileCheck2, href: "/review" });
  const settingsHref = mayManageWorkflowConfiguration
    ? "/settings/workflow"
    : mayManageUsers
      ? "/settings/users"
      : "/settings/delivery-profiles";

  return (
    <aside className="pp-sidebar fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col border-r px-3 py-5 md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2 text-white">
        <span className="pp-brand-mark flex h-8 w-8 items-center justify-center rounded-[9px] border border-white/20 bg-white/10 text-[11px] font-bold tracking-[-0.1em] text-white">PP</span>
        <span className="text-[15px] font-semibold tracking-[-0.025em] text-white">PostPilot</span>
      </Link>
      <nav className="space-y-1">
        {visible.map(({ label, icon: Icon, href }) => (
          <Link key={label} href={href} className="group flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition">
            <Icon size={16} strokeWidth={1.75} />
            <span className="flex-1">{label}</span>
            {label === "Approvals" && pending > 0 && <span className="rounded-full bg-[#e8d7c8] px-1.5 py-0.5 text-[10px] font-semibold text-[#714222]">{pending}</span>}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-white/10 pt-3">
        {(mayManageWorkflowConfiguration || mayManageUsers || mayManageDeliveryProfiles) && (
          <Link href={settingsHref} className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition">
            <Settings size={16} strokeWidth={1.75} /> Settings
          </Link>
        )}
        <div className="mt-4 flex items-center gap-2.5 px-3 pb-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#708f81] text-[10px] font-semibold text-white">{initials(person?.name)}</span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white/90">{person?.name ?? "PostPilot user"}</p>
            <p className="truncate text-[10px] capitalize text-white/45">{person?.role?.replaceAll("_", " ") ?? "Member"}</p>
          </div>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}

async function loadFastApprovalSummary(): Promise<[number, boolean]> {
  const inbox = await postpilotApiServerFetch<{
    has_workspace: boolean;
    sign_offs: Array<{ id: string }>;
    work_orders: Array<{ id: string }>;
  }>("/approvals");
  return [inbox.sign_offs.length + inbox.work_orders.length, inbox.has_workspace];
}

function initials(name?: string) {
  return (name ?? "PP")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
