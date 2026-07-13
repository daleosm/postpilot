import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { CateringSettingsForm } from "@/components/catering-settings-form";
import { getDb } from "@/lib/db";
import { cateringSettings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

export default async function CateringSettingsPage() { if (!(await can("manage_budget"))) redirect("/"); const context = await getActiveOrganizationContext(); const [settings] = context?.organization ? await getDb().select({ markupPercent: cateringSettings.markupPercent }).from(cateringSettings).where(eq(cateringSettings.organizationId, context.organization.organizationId)).limit(1) : []; return <div className="mx-auto max-w-5xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Catering billing</h1><p className="mt-1 text-sm text-[#747977]">Set how runner-paid catering costs are marked up before they are added to an episode bill.</p></header><CateringSettingsForm initialMarkup={settings?.markupPercent ?? "0"} /></div>; }
