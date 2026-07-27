import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { SsoSettingsPanel } from "@/components/sso-settings-panel";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

type MicrosoftLink = { linked: boolean; linked_identity_count: number; linked_at: string | null; last_used_at: string | null; local_password_available: boolean };
type SsoSettings = Parameters<typeof SsoSettingsPanel>[0]["settings"];

export default async function SsoSettingsPage() {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/sign-in");
  const mayManageSettings = await can("manage_settings");
  const [myLink, settings] = await Promise.all([
    postpilotApiServerFetch<MicrosoftLink>("/auth/microsoft/link"),
    mayManageSettings ? postpilotApiServerFetch<NonNullable<SsoSettings>>("/settings/sso") : Promise.resolve(null),
  ]);

  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Microsoft SSO</h1><p className="mt-1 max-w-3xl text-sm text-[#747977]">Use your post house’s Microsoft Entra connection for secure work-email sign-in. PostPilot keeps its own local account and session controls.</p></header><SsoSettingsPanel settings={settings} myLink={myLink} /></div>;
}
