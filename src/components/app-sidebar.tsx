import Link from "next/link";
import {
  Archive,
  CalendarRange,
  Coffee,
  Clapperboard,
  DollarSign,
  FileCheck2,
  House,
  Layers3,
  Settings,
  UsersRound,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";

const navigation = [
  { label: "Dashboard", icon: House, active: true, href: "/" },
  { label: "Shows", icon: Clapperboard, href: "/shows" },
  { label: "Episodes", icon: Layers3, href: "/episodes" },
  { label: "Bookings", icon: CalendarRange, href: "/bookings" },
  { label: "Review", icon: FileCheck2, badge: "12", href: "/review" },
  { label: "Catering", icon: Coffee, href: "/catering" },
  { label: "Runner desk", icon: Coffee, href: "/runner" },
  { label: "Deliverables", icon: Archive, href: "/deliverables" },
  { label: "Budget", icon: DollarSign, href: "/budget" },
  { label: "Team", icon: UsersRound, href: "/team" },
];

export function AppSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col border-r border-[#e6e5e1] bg-[#fbfbf9] px-3 py-5 md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#283131] text-[11px] font-bold tracking-[-0.1em] text-white">PH</span>
        <span className="text-[15px] font-semibold tracking-[-0.025em] text-[#2d3332]">PostPilot</span>
      </Link>
      <nav className="space-y-1">
        {navigation.map(({ label, icon: Icon, active, badge, href }) => (
          <Link key={label} href={href} className={`group flex h-9 items-center gap-3 rounded-md px-3 text-[13px] transition ${active ? "bg-[#e9ece9] font-medium text-[#29302f]" : "text-[#6d7270] hover:bg-[#f0f1ee] hover:text-[#353a39]"}`}>
            <Icon size={16} strokeWidth={active ? 2 : 1.75} />
            <span className="flex-1">{label}</span>
            {badge && <span className="rounded-full bg-[#e8d7c8] px-1.5 py-0.5 text-[10px] font-semibold text-[#976039]">{badge}</span>}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-[#e9e8e4] pt-3">
        <Link href="/settings/workflow" className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-[#6d7270] transition hover:bg-[#f0f1ee] hover:text-[#353a39]"><Settings size={16} strokeWidth={1.75} /> Settings</Link>
        <div className="mt-4 flex items-center gap-2.5 px-3 pb-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#b3937e] text-[10px] font-semibold text-white">MO</span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-[#3e4342]">Maya Ortiz</p>
            <p className="truncate text-[10px] text-[#8a8e8c]">Post supervisor</p>
          </div>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
