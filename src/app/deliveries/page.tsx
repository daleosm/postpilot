import { Truck } from "lucide-react";
import { notFound } from "next/navigation";

import { type DeliveryManifest } from "@/components/delivery-manifest-panel";
import { DeliveryRegister, type DeliveryRegisterEntry } from "@/components/delivery-register";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function DeliveriesPage() {
  const [context, manageManifests, updateItems, confirmReceipt] = await Promise.all([
    getActiveOrganizationContext(), can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt"),
  ]);
  if (!context?.organization || context.organization.role === "client" || !(manageManifests || updateItems || confirmReceipt)) notFound();
  const entries = await loadDeliveryRegister();
  return <div className="space-y-5"><header className="panel flex flex-wrap items-start justify-between gap-4 p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Truck size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">Operations</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">Deliveries</h1><p className="mt-1 text-sm text-[#777d79]">Episode manifests, facility dispatch, and recipient receipt—without media storage.</p></div></div></header><DeliveryRegister entries={entries} /></div>;
}

async function loadDeliveryRegister(): Promise<DeliveryRegisterEntry[]> {
  const response = await postpilotApiServerFetch<{ entries: Array<Record<string, unknown>> }>("/deliveries");
  return response.entries.map((entry) => ({
    episodeId: String(entry.episode_id),
    episodeNumber: Number(entry.episode_number),
    episodeTitle: String(entry.episode_title),
    productionCode: entry.production_code ? String(entry.production_code) : null,
    showId: String(entry.show_id),
    showTitle: String(entry.show_title),
    seasonNumber: Number(entry.season_number),
    deliveryDeadline: entry.delivery_deadline ? String(entry.delivery_deadline) : null,
    workflowState: entry.workflow_state ? {
      displayStatus: String((entry.workflow_state as Record<string, unknown>).display_status),
      primaryStageName: (entry.workflow_state as Record<string, unknown>).primary_stage_name ? String((entry.workflow_state as Record<string, unknown>).primary_stage_name) : null,
    } : null,
    manifest: entry.manifest ? camelize(entry.manifest) as DeliveryManifest : null,
    manifestState: entry.manifest_state === "applied" ? "applied" as const : "profile_not_applied" as const,
  }));
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), camelize(child)]));
}
