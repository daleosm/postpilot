"use client";

import { Button } from "@heroui/react";
import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";

import { safeCallbackPath } from "@/lib/auth-redirect";
import { getMicrosoftSsoClient, microsoftSsoBrowserConfig } from "@/lib/microsoft-sso";

const callbackStorageKey = "postpilot.microsoft-sso.callback-path";

export function MicrosoftSignInButton() {
  const configuration = microsoftSsoBrowserConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function finishRedirect() {
      try {
        if (!microsoftSsoBrowserConfig()) return;
        const client = getMicrosoftSsoClient();
        if (!client) return;
        await client.initialize();
        const result = await client.handleRedirectPromise();
        if (!result || cancelled) return;
        if (result.account) client.setActiveAccount(result.account);
        if (!result.accessToken) throw new Error("Microsoft did not return an API access token.");
        setBusy(true);
        // This is the only time an Entra access token is sent to PostPilot.
        // FastAPI validates it and mints the normal opaque session cookie.
        const response = await fetch("/v1/auth/microsoft/exchange", {
          method: "POST",
          headers: { Authorization: `Bearer ${result.accessToken}` },
          credentials: "include",
        });
        if (!response.ok) throw new Error("Microsoft SSO exchange failed.");
        const callbackUrl = safeCallbackPath(window.sessionStorage.getItem(callbackStorageKey));
        window.sessionStorage.removeItem(callbackStorageKey);
        window.location.assign(callbackUrl);
      } catch {
        if (!cancelled) {
          setError("Microsoft sign-in could not be completed. Use your password to sign in.");
          setBusy(false);
        }
      }
    }
    void finishRedirect();
    return () => { cancelled = true; };
  }, []);

  if (!configuration) return null;

  async function begin() {
    const settings = configuration;
    if (!settings) return;
    const client = getMicrosoftSsoClient();
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      await client.initialize();
      // This is navigation state, not Microsoft authentication state. MSAL
      // stores its own short-lived token cache in session storage; FastAPI's
      // HTTP-only cookie remains the only PostPilot session.
      const callbackUrl = safeCallbackPath(new URLSearchParams(window.location.search).get("callbackUrl"));
      window.sessionStorage.setItem(callbackStorageKey, callbackUrl);
      await client.loginRedirect({ scopes: [settings.apiScope] });
    } catch {
      setError("Microsoft sign-in could not start. Use your password to sign in.");
      setBusy(false);
    }
  }

  return <div className="space-y-2">
    <Button type="button" variant="tertiary" onPress={begin} isDisabled={busy} className="w-full border border-[#dfe3df] bg-white text-[#48534e] hover:bg-[#f6f8f5]">
      <Building2 size={16} /> {busy ? "Connecting to Microsoft…" : "Continue with Microsoft"}
    </Button>
    {error && <p role="alert" className="text-xs text-[#a05f43]">{error}</p>}
  </div>;
}
