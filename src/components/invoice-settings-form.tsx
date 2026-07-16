"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Settings = { legalName: string; legalAddress: string; billingEmail: string; taxName: string; taxRegistrationNumber: string; taxRatePercent: string | number; paymentTermsDays: number; paymentInstructions: string };

export function InvoiceSettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const set = (key: keyof Settings, value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function save() {
    setSaving(true); setMessage("");
    const response = await fetch("/api/settings/invoicing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setMessage(body?.error ?? "Could not save invoice settings.");
    setMessage("Invoice settings saved. New invoices will snapshot these details."); router.refresh();
  }
  return <section className="panel max-w-3xl p-5"><div><h2 className="text-sm font-semibold text-[#343b38]">Invoice issuer profile</h2><p className="mt-1 text-xs leading-5 text-[#858a87]">These details are copied into each issued invoice, so later edits never change existing financial documents.</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Legal entity name"><input value={values.legalName} onChange={(event) => set("legalName", event.target.value)} /></Field><Field label="Billing email"><input type="email" value={values.billingEmail} onChange={(event) => set("billingEmail", event.target.value)} /></Field><Field label="Tax label"><input value={values.taxName} onChange={(event) => set("taxName", event.target.value)} placeholder="VAT, GST, sales tax" /></Field><Field label="Tax registration number"><input value={values.taxRegistrationNumber} onChange={(event) => set("taxRegistrationNumber", event.target.value)} /></Field><Field label="Tax rate (%)"><input type="number" min="0" max="100" step="0.001" value={values.taxRatePercent} onChange={(event) => set("taxRatePercent", event.target.value)} /></Field><Field label="Default payment terms (days)"><input type="number" min="0" max="365" value={values.paymentTermsDays} onChange={(event) => set("paymentTermsDays", event.target.value)} /></Field></div><div className="mt-4"><Field label="Legal / registered address"><textarea rows={3} value={values.legalAddress} onChange={(event) => set("legalAddress", event.target.value)} /></Field></div><div className="mt-4"><Field label="Payment instructions"><textarea rows={3} value={values.paymentInstructions} onChange={(event) => set("paymentInstructions", event.target.value)} placeholder="Bank transfer details, remittance instruction, or payment portal link." /></Field></div><div className="mt-5 flex items-center gap-3"><Button variant="primary" isDisabled={saving || !values.legalName.trim()} onPress={save} className="bg-[#263130] text-white">{saving ? "Saving…" : "Save invoicing settings"}</Button>{message && <p role="status" className={`text-xs ${message.startsWith("Invoice settings saved") ? "text-[#557269]" : "text-[#a35e41]"}`}>{message}</p>}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-[#535b57]">{label}<span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:bg-white [&_textarea]:p-3 [&_textarea]:text-sm">{children}</span></label>; }
