import { ChefHat } from "lucide-react";

import { RunnerRequestList } from "@/components/runner-request-list";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { listCateringRequests } from "@/server/data";
import { demoRequests } from "../catering/page";
import { redirect } from "next/navigation";

export default async function RunnerPage() {
  if (!(await can("manage_catering"))) redirect("/catering");
  const data = await load();
  return <div className="space-y-5"><header className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf1ee] text-[#557269]"><ChefHat size={19} /></span><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Internal hospitality operations</p><h1 className="mt-1 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Runner desk</h1><p className="mt-1 text-sm text-[#747977]">Catering requests from edit bays, suites, and mix rooms.</p></div></header><RunnerRequestList requests={data.filter((request) => !["delivered", "cancelled"].includes(request.status))} /></div>;
}

async function load() {
  if (isDebugDemoMode) return demoRequests().map((request, index) => ({ ...request, bookingTitle: index ? "SN103 grade pass" : "SN104 final mix", episodeTitle: index ? "Tin Roof" : "Borrowed Light", requesterName: index ? "Priya Shah" : "James Liu" }));
  const context = await getActiveOrganizationContext();
  return context?.organization ? listCateringRequests(context.organization.organizationId) : [];
}
