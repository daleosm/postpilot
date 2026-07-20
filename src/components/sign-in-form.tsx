"use client";

import { Button } from "@heroui/react";
import { Clapperboard, LockKeyhole, MonitorPlay } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { safeCallbackPath } from "@/lib/auth-redirect";

export function SignInForm({ debugMode }: { debugMode: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signInWithPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const callbackUrl = safeCallbackPath(new URLSearchParams(window.location.search).get("callbackUrl"));
    const result = await signIn("credentials", { email, password, callbackUrl, redirect: false });
    setBusy(false);
    if (result?.error) return setError("Email or password is incorrect.");
    // Credentials sign-in writes the Auth.js session cookie immediately before
    // this navigation. Use a document navigation so a protected route never
    // races a client-router refresh with that freshly written cookie.
    window.location.assign(callbackUrl);
  }

  async function openDebugWorkspace() {
    setBusy(true); setError("");
    const response = await fetch("/api/debug/user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setBusy(false);
    if (!response.ok) return setError("Could not open the debug workspace.");
    router.push("/"); router.refresh();
  }

  return (
    <main className="flex min-h-[calc(100vh-122px)] items-center justify-center px-6">
      <section className="w-full max-w-[400px] rounded-xl border border-[#e6e5e1] bg-[#fafbf9] p-7 shadow-sm">
        <div className="mb-7 flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#283131] text-white"><Clapperboard size={18} /></span><span className="text-lg font-semibold tracking-[-0.03em] text-[#2d3332]">PostPilot</span></div>
        <h1 className="text-xl font-semibold tracking-[-0.035em] text-[#272c2b]">Sign in to your post floor</h1>
        <p className="mt-2 text-sm leading-6 text-[#737776]">Use your work email and password to enter the post floor.</p>
        {debugMode && (
          <div className="mt-7 rounded-lg border border-[#dce6e1] bg-[#f3f8f5] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#3e6258]"><MonitorPlay size={16} /> Demo mode is on</div>
            <p className="mt-1.5 text-xs leading-5 text-[#60766e]">All seeded accounts use the temporary password <span className="font-semibold">password</span>. You can also open the command center directly.</p>
            <Button variant="primary" onPress={openDebugWorkspace} isDisabled={busy} className="mt-4 w-full bg-[#325b52] text-white">Open demo workspace</Button>
          </div>
        )}
        <form className="mt-7 space-y-4" onSubmit={signInWithPassword}>
          <label className="block text-xs font-medium text-[#535956]">Work email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="you@facility.com" className="mt-1.5 h-10 w-full rounded-md border border-[#dededa] bg-white px-3 text-sm outline-none transition focus:border-[#63877f] focus:ring-2 focus:ring-[#dce9e4]" /></label>
          <label className="block text-xs font-medium text-[#535956]">Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required className="mt-1.5 h-10 w-full rounded-md border border-[#dededa] bg-white px-3 text-sm outline-none transition focus:border-[#63877f] focus:ring-2 focus:ring-[#dce9e4]" /></label>
          {error && <p role="alert" className="text-xs text-[#a05f43]">{error}</p>}
          <Button type="submit" variant="primary" isDisabled={busy} className="w-full bg-[#283131] text-white"><LockKeyhole size={16} /> {busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </section>
    </main>
  );
}
