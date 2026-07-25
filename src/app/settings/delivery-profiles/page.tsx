import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DeliveryProfileManager } from "@/components/delivery-profile-manager";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function DeliveryProfileSettingsPage() {
  if (!(await can("manage_delivery_profiles"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const { profiles, companies, showRows, recipients } = await loadFastApiData();

  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Delivery profiles</h1><p className="mt-1 max-w-3xl text-sm text-[#747977]">Create the reusable network, streamer, or show delivery checklists that are copied to episodes. Profile edits never alter a manifest already applied to an episode.</p></header><DeliveryProfileManager profiles={profiles} companies={companies} shows={showRows} recipients={recipients} /></div>;
}

async function loadFastApiData() {
  type ProfileItem = { id: string; component_type: string; label: string; required: boolean; format_specification: string | null; version: string | null; territory: string | null; language: string | null; recipient_contact_id: string | null; recipient_name: string | null; recipient_email: string | null; requires_external_recipient: boolean; qc_required: boolean; default_deadline_offset_days: number | null; position: number };
  type Profile = { id: string; name: string; client_company_id: string | null; network: string | null; show_id: string | null; specification_url: string | null; is_active: boolean; items: ProfileItem[] };
  const [profileIndex, companiesResponse, showsResponse, contactsResponse] = await Promise.all([
    postpilotApiServerFetch<{ profiles: Array<{ id: string }> }>("/delivery-profiles"),
    postpilotApiServerFetch<{ companies: Array<{ id: string; name: string; type: string }> }>("/crm/companies"),
    postpilotApiServerFetch<{ shows: Array<{ id: string; title: string }> }>("/shows"),
    postpilotApiServerFetch<{ contacts: Array<{ id: string; name: string; email: string | null; company_type: string }> }>("/crm/contacts"),
  ]);
  const details = await Promise.all(profileIndex.profiles.map(({ id }) => postpilotApiServerFetch<{ profile: Profile }>(`/delivery-profiles/${id}`)));
  return {
    profiles: details.map(({ profile }) => ({
      id: profile.id, name: profile.name, clientCompanyId: profile.client_company_id, network: profile.network,
      showId: profile.show_id, specificationUrl: profile.specification_url, isActive: profile.is_active,
      items: profile.items.map((item) => ({
        id: item.id, componentType: item.component_type, label: item.label, required: item.required,
        formatSpecification: item.format_specification, version: item.version, territory: item.territory, language: item.language,
        recipientContactId: item.recipient_contact_id, recipientName: item.recipient_name, recipientEmail: item.recipient_email,
        requiresExternalRecipient: item.requires_external_recipient, qcRequired: item.qc_required,
        defaultDeadlineOffsetDays: item.default_deadline_offset_days, position: item.position,
      })),
    })),
    companies: companiesResponse.companies.filter((company) => company.type !== "vendor").map(({ id, name }) => ({ id, name })),
    showRows: showsResponse.shows.map(({ id, title }) => ({ id, name: title })),
    recipients: contactsResponse.contacts.filter((contact) => contact.company_type === "network" || contact.company_type === "studio").map(({ id, name, email }) => ({ id, name, email })),
  };
}
