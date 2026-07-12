"use client";

import { Button } from "@heroui/react";
import { Clapperboard, MailCheck, MonitorPlay } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function SignInForm({ debugMode }: { debugMode: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const response = await fetch("/api/auth/request-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error ?? "Could not send a code.");
    setSent(true);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const result = await signIn("email-otp", { email, code, redirect: false });
    setBusy(false);
    if (result?.error) return setError("That code is invalid or has expired.");
    router.push("/"); router.refresh();
  }

  return (
    <main className="flex min-h-[calc(100vh-122px)] items-center justify-center px-6">
      <section className="w-full max-w-[400px] rounded-xl border border-[#e6e5e1] bg-white p-7 shadow-sm">
        <div className="mb-7 flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#283131] text-white"><Clapperboard size={18} /></span><span className="text-lg font-semibold tracking-[-0.03em] text-[#2d3332]">PostPilot</span></div>
        <h1 className="text-xl font-semibold tracking-[-0.035em] text-[#272c2b]">Sign in to your post floor</h1>
        <p className="mt-2 text-sm leading-6 text-[#737776]">We’ll send a six-digit passcode to your work email.</p>
        {debugMode ? (
          <div className="mt-7 rounded-lg border border-[#dce6e1] bg-[#f3f8f5] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#3e6258]"><MonitorPlay size={16} /> Demo mode is on</div>
            <p className="mt-1.5 text-xs leading-5 text-[#60766e]">Open the seeded command center without an email, database, or one-time passcode.</p>
            <Button variant="primary" onPress={() => router.push("/")} className="mt-4 w-full bg-[#325b52] text-white">Open demo workspace</Button>
          </div>
        ) : !sent ? (
          <form className="mt-7 space-y-4" onSubmit={requestCode}>
            <label className="block text-xs font-medium text-[#535956]">Work email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="you@facility.com" className="mt-1.5 h-10 w-full rounded-md border border-[#dededa] bg-white px-3 text-sm outline-none transition focus:border-[#63877f] focus:ring-2 focus:ring-[#dce9e4]" /></label>
            {error && <p className="text-xs text-[#a05f43]">{error}</p>}
            <Button type="submit" variant="primary" isDisabled={busy} className="w-full bg-[#283131] text-white"><MailCheck size={16} /> {busy ? "Sending…" : "Email me a code"}</Button>
          </form>
        ) : (
          <form className="mt-7 space-y-4" onSubmit={verifyCode}>
            <p className="rounded-md bg-[#f5f6f3] px-3 py-2 text-xs text-[#68706d]">Code sent to <span className="font-medium text-[#444b48]">{email}</span></p>
            <label className="block text-xs font-medium text-[#535956]">Six-digit code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required placeholder="000000" className="mt-1.5 h-11 w-full rounded-md border border-[#dededa] bg-white px-3 text-center font-mono text-lg tracking-[0.35em] outline-none transition focus:border-[#63877f] focus:ring-2 focus:ring-[#dce9e4]" /></label>
            {error && <p className="text-xs text-[#a05f43]">{error}</p>}
            <Button type="submit" variant="primary" isDisabled={busy || code.length !== 6} className="w-full bg-[#283131] text-white">{busy ? "Checking…" : "Sign in"}</Button>
            <button type="button" onClick={() => setSent(false)} className="w-full text-xs font-medium text-[#607c76]">Use a different email</button>
          </form>
        )}
      </section>
    </main>
  );
}
