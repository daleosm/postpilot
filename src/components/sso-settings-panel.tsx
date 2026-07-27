"use client";

import { Button } from "@heroui/react";
import { CheckCircle2, KeyRound, Link2Off, LogOut, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";
import { microsoftSsoBrowserConfig, signOutFromMicrosoft } from "@/lib/microsoft-sso";

type MicrosoftLink = {
  linked: boolean;
  linked_identity_count: number;
  linked_at: string | null;
  last_used_at: string | null;
  local_password_available: boolean;
};

type SsoSettings = {
  runtime_enabled: boolean;
  connection: {
    enabled: boolean;
    entra_tenant_id: string;
    allowed_email_domains: string[];
    updated_at: string | null;
  } | null;
  linked_user_count: number;
  users: Array<{
    user_id: string;
    user_name: string | null;
    email: string;
    membership_role: string;
    microsoft_linked: boolean;
    microsoft_linked_at: string | null;
  }>;
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : null;
}

export function SsoSettingsPanel({ settings, myLink }: { settings: SsoSettings | null; myLink: MicrosoftLink }) {
  const router = useRouter();
  const [working, setWorking] = useState<"connection" | "disconnect" | "microsoft_sign_out" | null>(null);
  const [message, setMessage] = useState("");
  const microsoftBrowserConfigured = Boolean(microsoftSsoBrowserConfig());

  async function toggleConnection() {
    if (!settings?.connection) return;
    setWorking("connection");
    setMessage("");
    const response = await postpilotUiFetch("/v1/settings/sso/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !settings.connection.enabled }),
    });
    const body = await response.json().catch(() => null);
    setWorking(null);
    if (!response.ok) return setMessage(body?.error ?? "Could not update Microsoft SSO.");
    setMessage(body.enabled ? "Microsoft SSO enabled for this post house." : "Microsoft SSO disabled for this post house.");
    router.refresh();
  }

  async function disconnect() {
    setWorking("disconnect");
    setMessage("");
    const response = await postpilotUiFetch("/v1/auth/microsoft/link", { method: "DELETE" });
    const body = await response.json().catch(() => null);
    setWorking(null);
    if (!response.ok) return setMessage(body?.error ?? "Could not disconnect Microsoft sign-in.");
    setMessage("Microsoft sign-in disconnected. Your password remains available.");
    router.refresh();
  }

  async function signOutMicrosoft() {
    setWorking("microsoft_sign_out");
    setMessage("");
    try {
      const started = await signOutFromMicrosoft();
      if (!started) setMessage("Microsoft sign-in is not configured in this browser build.");
    } catch {
      setMessage("Could not start Microsoft sign-out. Your PostPilot session is still active.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-5">
      {settings && (
        <section className="panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-[#ecebe7] px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-[#343b38]">Microsoft Entra connection</h2>{settings.connection?.enabled ? <span className="rounded-full bg-[#e3f0ea] px-2 py-0.5 text-[11px] font-semibold text-[#3f745e]">Enabled</span> : <span className="rounded-full bg-[#f2f1ee] px-2 py-0.5 text-[11px] font-semibold text-[#6f7471]">Disabled</span>}</div>
              <p className="mt-1 text-xs leading-5 text-[#858a87]">This control only changes this post house’s access to its preconfigured Entra directory. Microsoft identity links cannot be edited here.</p>
            </div>
            {settings.connection && <Button variant="primary" isDisabled={working !== null || (!settings.runtime_enabled && !settings.connection.enabled)} onPress={toggleConnection} className="bg-[#263130] text-white">{working === "connection" ? "Saving…" : settings.connection.enabled ? "Disable Microsoft SSO" : "Enable Microsoft SSO"}</Button>}
          </div>
          {!settings.runtime_enabled && <div className="flex gap-2 border-b border-[#efe2d6] bg-[#fff9f3] px-5 py-3 text-xs leading-5 text-[#8b5d39]"><ShieldAlert className="mt-0.5 shrink-0" size={15} />Microsoft SSO is disabled at deployment level. A configured connection can be viewed or disabled, but cannot be enabled until the deployment is configured.</div>}
          {!settings.connection ? <div className="px-5 py-7 text-sm text-[#737976]">No Entra directory has been configured for this post house. Add the tenant connection through the deployment configuration before enabling SSO.</div> : <div className="grid gap-4 px-5 py-5 sm:grid-cols-3"><Info label="Entra directory tenant" value={settings.connection.entra_tenant_id} /><Info label="Allowed work-email domains" value={settings.connection.allowed_email_domains.length ? settings.connection.allowed_email_domains.join(", ") : "Any verified work-email domain"} /><Info label="Linked users" value={String(settings.linked_user_count)} /></div>}
          {settings.connection && <div className="border-t border-[#ecebe7]"><div className="flex items-center justify-between px-5 py-3"><h3 className="text-xs font-semibold text-[#59615d]">User link status</h3><span className="text-xs text-[#858a87]">{settings.users.length} tenant users</span></div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[580px] text-left text-xs"><thead className="sticky top-0 bg-[#fafaf8] text-[#757b77]"><tr><th className="px-5 py-2.5 font-medium">User</th><th className="px-4 py-2.5 font-medium">Tenant role</th><th className="px-5 py-2.5 text-right font-medium">Microsoft status</th></tr></thead><tbody className="divide-y divide-[#efeeea]">{settings.users.map((user) => <tr key={user.user_id}><td className="px-5 py-3"><p className="font-medium text-[#424a46]">{user.user_name ?? user.email}</p><p className="mt-0.5 text-[#858a87]">{user.email}</p></td><td className="px-4 py-3 capitalize text-[#6f7672]">{user.membership_role}</td><td className="px-5 py-3 text-right">{user.microsoft_linked ? <span className="inline-flex items-center gap-1 text-[#477764]"><CheckCircle2 size={14} />Linked{user.microsoft_linked_at ? ` · ${formatDate(user.microsoft_linked_at)}` : ""}</span> : <span className="text-[#858a87]">Not linked</span>}</td></tr>)}</tbody></table></div></div>}
        </section>
      )}

      <section className="panel p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#343b38]">Your Microsoft sign-in</h2>
            <p className="mt-1 text-xs leading-5 text-[#858a87]">{myLink.linked ? `Linked${myLink.linked_identity_count > 1 ? ` to ${myLink.linked_identity_count} Microsoft identities` : ""}${myLink.linked_at ? ` on ${formatDate(myLink.linked_at)}` : ""}.` : "No Microsoft identity is linked to your account."}</p>
            {myLink.linked && !myLink.local_password_available && <p className="mt-2 text-xs leading-5 text-[#a05f43]">Set a local password before disconnecting Microsoft sign-in so you retain a way to access PostPilot.</p>}
          </div>
          {myLink.linked && <div className="flex flex-wrap gap-2"><Button variant="tertiary" isDisabled={working !== null || !microsoftBrowserConfigured} onPress={signOutMicrosoft} className="border border-[#dfe3df] bg-white text-[#59635e]"><LogOut size={15} />{working === "microsoft_sign_out" ? "Opening Microsoft…" : "Sign out of Microsoft"}</Button><Button variant="tertiary" isDisabled={!myLink.local_password_available || working !== null} onPress={disconnect} className="border border-[#e3d6cd] bg-white text-[#975839]"><Link2Off size={15} />{working === "disconnect" ? "Disconnecting…" : "Disconnect Microsoft"}</Button></div>}
          {!myLink.linked && <span className="inline-flex items-center gap-2 text-xs font-medium text-[#7a807c]"><KeyRound size={15} />Password sign-in remains available</span>}
        </div>
        {myLink.linked && microsoftBrowserConfigured && <p className="mt-3 text-xs leading-5 text-[#858a87]">Microsoft sign-out ends the Entra browser session only. Your current PostPilot session remains active until you use Sign out.</p>}
      </section>
      {message && <p role="status" className={`text-xs ${message.includes("could not") ? "text-[#a05f43]" : "text-[#4f7367]"}`}>{message}</p>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8b908d]">{label}</p><p className="mt-1 break-words text-sm text-[#47504b]">{value}</p></div>;
}
