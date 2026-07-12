import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { RoomSetup } from "@/components/room-setup";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { listRooms } from "@/server/data";

export default async function RoomSettingsPage() {
  if (!(await can("manage_bookings"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const rooms = await listRooms(context.organization.organizationId);
  return <div className="mx-auto max-w-5xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Post workflow</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Rooms & suites</h1><p className="mt-1 text-sm text-[#747977]">Set up the edit bays, finishing suites, mix rooms, and QC rooms this post house can book.</p></header><RoomSetup rooms={rooms} /></div>;
}
