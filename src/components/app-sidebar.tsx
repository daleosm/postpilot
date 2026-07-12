import Link from "next/link";
import { Archive, CalendarRange, Coffee, Clapperboard, DollarSign, FileCheck2, House, Layers3, Settings, UsersRound } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getCurrentPerson, isExternalReviewerRole, type Permission } from "@/lib/permissions";
import { listWorkflowSignOffInbox } from "@/server/data";

const navigation = [
  { label: "Dashboard", icon: House, href: "/" },
  { label: "Shows", icon: Clapperboard, href: "/shows", permissions: ["manage_shows"] as Permission[] },
  { label: "Episodes", icon: Layers3, href: "/episodes", permissions: ["manage_shows", "update_tasks"] as Permission[] },
  { label: "Bookings", icon: CalendarRange, href: "/bookings", permissions: ["manage_bookings"] as Permission[] },
  { label: "Approvals", icon: FileCheck2, href: "/review", permissions: ["manage_reviews", "approve_reviews", "update_notes"] as Permission[] },
  { label: "Catering", icon: Coffee, href: "/catering", permissions: ["request_catering"] as Permission[] },
  { label: "Runner desk", icon: Coffee, href: "/runner", permissions: ["manage_catering"] as Permission[] },
  { label: "Deliverables", icon: Archive, href: "/deliverables", permissions: ["manage_deliverables"] as Permission[] },
  { label: "Budget", icon: DollarSign, href: "/budget", permissions: ["manage_budget"] as Permission[] },
  { label: "Team", icon: UsersRound, href: "/team", permissions: ["manage_shows"] as Permission[] },
];

export async function AppSidebar() {
  const [person, context, mayManageShows, permitted] = await Promise.all([
    getCurrentPerson(), getActiveOrganizationContext(), can("manage_shows"),
    Promise.all(navigation.map(async (item) => !item.permissions || (await Promise.all(item.permissions.map((permission) => can(permission)))).some(Boolean) ? item : null)),
  ]);
  const pending = context?.organization && context.person ? (await listWorkflowSignOffInbox(context.organization.organizationId, context.userId)).length : 0;
  const restrictedExternalReviewer = isExternalReviewerRole(person?.role) && !(person?.role === "director" && mayManageShows);
  const visible = (restrictedExternalReviewer ? permitted.filter((item) => item?.label === "Approvals") : permitted).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col border-r border-[#e6e5e1] bg-[#fbfbf9] px-3 py-5 md:flex"><Link href="/" className="mb-8 flex items-center gap-2.5 px-2"><span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#283131] text-[11px] font-bold tracking-[-0.1em] text-white">PH</span><span className="text-[15px] font-semibold tracking-[-0.025em] text-[#2d3332]">PostPilot</span></Link><nav className="space-y-1">{visible.map(({ label, icon: Icon, href }) => <Link key={label} href={href} className="group flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-[#6d7270] transition hover:bg-[#f0f1ee] hover:text-[#353a39]"><Icon size={16} strokeWidth={1.75} /><span className="flex-1">{label}</span>{label === "Approvals" && pending > 0 && <span className="rounded-full bg-[#e8d7c8] px-1.5 py-0.5 text-[10px] font-semibold text-[#976039]">{pending}</span>}</Link>)}</nav><div className="mt-auto border-t border-[#e9e8e4] pt-3">{mayManageShows && <Link href="/settings/workflow" className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-[#6d7270] transition hover:bg-[#f0f1ee] hover:text-[#353a39]"><Settings size={16} strokeWidth={1.75} /> Settings</Link>}<div className="mt-4 flex items-center gap-2.5 px-3 pb-1"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#b3937e] text-[10px] font-semibold text-white">{initials(person?.name)}</span><div className="min-w-0"><p className="truncate text-xs font-medium text-[#3e4342]">{person?.name ?? "PostPilot user"}</p><p className="truncate text-[10px] capitalize text-[#8a8e8c]">{person?.role?.replaceAll("_", " ") ?? "Member"}</p></div></div><LogoutButton /></div></aside>;
}
function initials(name?: string) { return (name ?? "PP").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
