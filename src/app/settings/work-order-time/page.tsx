import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { WorkOrderTimeSettingsForm } from "@/components/work-order-time-settings-form";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function WorkOrderTimeSettingsPage() {
  if (!(await can("manage_settings"))) redirect("/");
  const settings = await postpilotApiServerFetch<{ organization: { standard_day_hours: string | number } }>("/settings/bootstrap");
  return <div className="mx-auto max-w-5xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Work-order time</h1><p className="mt-1 text-sm text-[#747977]">Define the facility day used when work is sold in days, half-days, or weeks.</p></header><WorkOrderTimeSettingsForm initialStandardDayHours={settings.organization.standard_day_hours} /></div>;
}
