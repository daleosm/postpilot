import { ChefHat } from "lucide-react";
import { redirect } from "next/navigation";

import { RunnerRequestList } from "@/components/runner-request-list";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function RunnerPage() {
  if (!(await can("manage_catering"))) redirect("/catering");
  const data = await load();
  return <div className="space-y-5"><header className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf1ee] text-[#557269]"><ChefHat size={19} /></span><div><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Internal hospitality operations</p><h1 className="mt-1 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Runner desk</h1><p className="mt-1 text-sm text-[#747977]">Catering requests from edit bays, suites, and mix rooms.</p></div></header><RunnerRequestList requests={data.filter((request) => request.status !== "cancelled")} /></div>;
}

async function load() {
  return postpilotApiServerFetch<Array<{ id: string; request_type: string; item: string; quantity: number; notes: string | null; requested_for: string | null; status: string; room_name: string | null; actual_cost: number | null; billed_amount: number | null; markup_percent: number | null; currency: string; requester_name: string | null }>>("/catering-requests")
    .then((requests) => requests.map((request) => ({ id: request.id, requestType: request.request_type, item: request.item, quantity: request.quantity, notes: request.notes, requestedFor: request.requested_for ? new Date(request.requested_for) : null, status: request.status, roomName: request.room_name, actualCost: request.actual_cost, billedAmount: request.billed_amount, markupPercent: request.markup_percent, currency: request.currency, requesterName: request.requester_name })));
}
