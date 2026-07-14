"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const currencies = [
  ["GBP", "British pound (GBP)"],
  ["USD", "US dollar (USD)"],
  ["EUR", "Euro (EUR)"],
  ["CAD", "Canadian dollar (CAD)"],
  ["AUD", "Australian dollar (AUD)"],
] as const;

export function CurrencySettingsForm({ initialCurrency }: { initialCurrency: string }) {
  const router = useRouter();
  const [currency, setCurrency] = useState(initialCurrency);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true); setMessage("");
    const response = await fetch("/api/settings/currency", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency }) });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setMessage(body?.error ?? "Could not save the reporting currency.");
    setMessage("Saved. All commercial records now use this reporting currency.");
    router.refresh();
  }

  return <section className="panel max-w-xl p-5"><h2 className="text-sm font-semibold text-[#343b38]">Post house reporting currency</h2><p className="mt-1 text-xs leading-5 text-[#858a87]">PostPilot uses one currency per post house for budgets, service rates, work orders, vendor costs, catering, and client billables.</p><label className="mt-5 block text-xs font-medium text-[#535b57]">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1.5 h-10 w-full max-w-sm rounded-md border border-[#dedfda] bg-white px-3 text-sm">{currencies.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><p className="mt-3 text-xs leading-5 text-[#8a6b43]">Changing this updates the currency label across this post house. It does not convert existing amounts.</p><div className="mt-5 flex items-center gap-3"><Button variant="primary" isDisabled={saving} onPress={save} className="bg-[#263130] text-white">{saving ? "Saving…" : "Save currency"}</Button>{message && <p className={`text-xs ${message.startsWith("Saved") ? "text-[#557269]" : "text-[#a35e41]"}`}>{message}</p>}</div></section>;
}
