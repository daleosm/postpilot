import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CurrencySettingsForm } from "@/components/currency-settings-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

export default async function CurrencySettingsPage() {
  if (!(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  return <div className="mx-auto max-w-5xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Currency</h1><p className="mt-1 text-sm text-[#747977]">Set one reporting currency for {context.organization.organizationName}.</p></header><CurrencySettingsForm initialCurrency={context.organization.currency} /></div>;
}
