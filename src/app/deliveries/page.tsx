import { Truck } from "lucide-react";
import { notFound } from "next/navigation";

import { DeliveryRegister } from "@/components/delivery-register";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { listDeliveryRegisterForOrganization } from "@/server/data";

export default async function DeliveriesPage() {
  const [context, manageManifests, updateItems, confirmReceipt] = await Promise.all([
    getActiveOrganizationContext(), can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt"),
  ]);
  if (!context?.organization || context.organization.role === "client" || !(manageManifests || updateItems || confirmReceipt)) notFound();
  const entries = await listDeliveryRegisterForOrganization(context.organization.organizationId);
  return <div className="space-y-5"><header className="panel flex flex-wrap items-start justify-between gap-4 p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Truck size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">Operations</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">Deliveries</h1><p className="mt-1 text-sm text-[#777d79]">Episode manifests, facility dispatch, and recipient receipt—without media storage.</p></div></div></header><DeliveryRegister entries={entries} /></div>;
}
