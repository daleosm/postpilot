import { and, asc, eq, inArray } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DeliveryProfileManager } from "@/components/delivery-profile-manager";
import { getDb } from "@/lib/db";
import { crmCompanies, crmContacts, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getDeliveryProfileForOrganization, listDeliveryProfilesForOrganization } from "@/server/delivery-manifests";

export default async function DeliveryProfileSettingsPage() {
  if (!(await can("manage_delivery_profiles"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [profileRows, companies, showRows, recipients] = await Promise.all([
    listDeliveryProfilesForOrganization(organizationId),
    db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies).where(and(eq(crmCompanies.organizationId, organizationId), inArray(crmCompanies.type, ["client", "network", "studio", "production_company"]))).orderBy(asc(crmCompanies.name)),
    db.select({ id: shows.id, name: shows.title }).from(shows).where(eq(shows.organizationId, organizationId)).orderBy(asc(shows.title)),
    db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email }).from(crmContacts).innerJoin(crmCompanies, and(eq(crmContacts.companyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId))).where(and(eq(crmContacts.organizationId, organizationId), inArray(crmCompanies.type, ["network", "studio"]))).orderBy(asc(crmContacts.name)),
  ]);
  const profiles = (await Promise.all(profileRows.map((profile) => getDeliveryProfileForOrganization(organizationId, profile.id)))).filter((profile): profile is NonNullable<typeof profile> => profile !== null);

  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Delivery profiles</h1><p className="mt-1 max-w-3xl text-sm text-[#747977]">Create the reusable network, streamer, or show delivery checklists that are copied to episodes. Profile edits never alter a manifest already applied to an episode.</p></header><DeliveryProfileManager profiles={profiles} companies={companies} shows={showRows} recipients={recipients} /></div>;
}
