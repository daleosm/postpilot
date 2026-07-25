import { notFound } from "next/navigation";

import { type DeliveryManifest } from "@/components/delivery-manifest-panel";
import { DeliveryRegister, type DeliveryRegisterEntry } from "@/components/delivery-register";
import { PageHeader } from "@/components/operations-ui";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function DeliveriesPage() {
  const [context, manageManifests, updateItems, confirmReceipt] = await Promise.all([
    getActiveOrganizationContext(), can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt"),
  ]);
  if (!context?.organization || context.organization.role === "client" || !(manageManifests || updateItems || confirmReceipt)) notFound();
  const entries = await loadDeliveryRegister();
  const applied = entries.filter((entry) => entry.manifestState === "applied");
  const attention = applied.filter((entry) => entry.manifest?.readiness.deadlineRisk !== "on_track").length;
  return <div className="pp-page"><PageHeader eyebrow="Post delivery operations" title="Deliveries" description="Episode manifests, facility dispatch, and recipient receipt—without media storage." metrics={[{ label: "Episodes", value: entries.length }, { label: "Manifests", value: applied.length, tone: "success" }, { label: "Attention", value: attention, tone: attention ? "warning" : "success" }]} /><DeliveryRegister entries={entries} /></div>;
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
