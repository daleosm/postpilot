import { Coffee } from "lucide-react";

import { CateringRequestForm } from "@/components/catering-request-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can, getCurrentPerson } from "@/lib/permissions";
import { getCateringResources, listCateringRequests } from "@/server/data";
import { redirect } from "next/navigation";

export default async function CateringPage() {
  if (!(await can("request_catering"))) redirect("/");
  const data = await load();
  return <div className="space-y-5"><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Post floor hospitality · {data.organizationName}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Catering</h1><p className="mt-1 text-sm text-[#747977]">Request lunch, tea, coffee, and snacks without interrupting the post floor.</p></header><CateringRequestForm resources={data.resources} /><section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-4"><Coffee size={16} className="text-[#557269]" /><div><h2 className="text-sm font-semibold text-[#343b38]">Your floor requests</h2><p className="mt-0.5 text-xs text-[#858a87]">Runner desk updates appear here.</p></div></div><div className="divide-y divide-[#efeeea]">{data.requests.slice(0, 6).map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium text-[#414945]">{request.quantity}× {request.item}</p><p className="mt-0.5 text-xs text-[#858a87]">{request.roomName ?? "Room pending"} · {request.requestType.replaceAll("_", " ")}</p></div><span className="rounded-full bg-[#edf1ee] px-2 py-1 text-[10px] font-semibold capitalize text-[#557269]">{request.status.replaceAll("_", " ")}</span></div>)}{!data.requests.length && <p className="px-5 py-9 text-center text-sm text-[#858a87]">No catering requests yet.</p>}</div></section></div>;
}

async function load() {
  if (isDebugDemoMode) return { organizationName: "Northstar Post · Demo workspace", resources: { rooms: [{ id: "room-1", name: "Edit Bay 1", type: "edit bay" }, { id: "room-2", name: "Colour 1", type: "colour suite" }, { id: "room-3", name: "Mix A", type: "mix room" }], bookings: [{ id: "booking-1", roomName: "Mix A" }, { id: "booking-2", roomName: "Colour 1" }] }, requests: demoRequests() };
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return { organizationName: "No workspace", resources: { rooms: [], bookings: [] }, requests: [] };
  const [resources, person, canManage] = await Promise.all([getCateringResources(context.organization.organizationId), getCurrentPerson(), can("manage_catering")]);
  const requests = await listCateringRequests(context.organization.organizationId, canManage ? undefined : person?.id);
  return { organizationName: context.organization.organizationName, resources, requests };
}

export function demoRequests() { return [{ id: "catering-1", requestType: "tea_coffee", item: "Oat milk flat white", quantity: 2, notes: "One decaf", requestedFor: new Date(), status: "preparing", roomName: "Edit Bay 1" }, { id: "catering-2", requestType: "lunch", item: "Chicken Caesar salad", quantity: 1, notes: null, requestedFor: new Date(), status: "requested", roomName: "Colour 1" }]; }
