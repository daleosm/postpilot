import { Coffee } from "lucide-react";

import { CateringRequestForm } from "@/components/catering-request-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function CateringPage() {
  if (!(await can("request_catering"))) redirect("/");
  const data = await load();
  return <div className="space-y-5"><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Post floor hospitality · {data.organizationName}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Catering</h1><p className="mt-1 text-sm text-[#747977]">Request lunch, tea, coffee, and snacks without interrupting the post floor.</p></header><CateringRequestForm resources={data.resources} /><section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-4"><Coffee size={16} className="text-[#557269]" /><div><h2 className="text-sm font-semibold text-[#343b38]">Your floor requests</h2><p className="mt-0.5 text-xs text-[#858a87]">Runner desk updates appear here.</p></div></div><div className="divide-y divide-[#efeeea]">{data.requests.slice(0, 6).map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium text-[#414945]">{request.quantity}× {request.item}</p><p className="mt-0.5 text-xs text-[#858a87]">{request.roomName ?? "Room pending"} · {request.requestType.replaceAll("_", " ")}</p></div><span className="rounded-full bg-[#edf1ee] px-2 py-1 text-[10px] font-semibold capitalize text-[#557269]">{request.status.replaceAll("_", " ")}</span></div>)}{!data.requests.length && <p className="px-5 py-9 text-center text-sm text-[#858a87]">No catering requests yet.</p>}</div></section></div>;
}

async function load() {
  const context = await getActiveOrganizationContext();
  const [resources, requests] = await Promise.all([
    postpilotApiServerFetch<{ rooms: Array<{ id: string; name: string; type: string }>; active_booking: { id: string; room_id: string; room_name: string } | null; active_work_order: { id: string; episode_id: string; title: string } | null }>("/catering/resources"),
    postpilotApiServerFetch<Array<{ id: string; request_type: string; item: string; quantity: number; notes: string | null; requested_for: string | null; status: string; room_name: string | null }>>("/catering-requests"),
  ]);
  return {
    organizationName: context?.organization?.organizationName ?? "Post house",
    resources: { rooms: resources.rooms, activeBooking: resources.active_booking ? { id: resources.active_booking.id, roomId: resources.active_booking.room_id, roomName: resources.active_booking.room_name } : null, activeWorkOrder: resources.active_work_order ? { id: resources.active_work_order.id, episodeId: resources.active_work_order.episode_id, title: resources.active_work_order.title } : null },
    requests: requests.map((request) => ({ id: request.id, requestType: request.request_type, item: request.item, quantity: request.quantity, notes: request.notes, requestedFor: request.requested_for ? new Date(request.requested_for) : null, status: request.status, roomName: request.room_name })),
  };
}
