import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InvoiceSettingsForm } from "@/components/invoice-settings-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function InvoicingSettingsPage() {
  if (!(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const settings = await postpilotApiServerFetch<{ invoice: { legal_name: string | null; legal_address: string | null; billing_email: string | null; tax_enabled: boolean; tax_name: string; tax_registration_number: string | null; tax_rate_percent: number | string; payment_terms_days: number; payment_instructions: string | null } | null }>("/settings/bootstrap").then((data) => data.invoice ? ({ legalName: data.invoice.legal_name, legalAddress: data.invoice.legal_address, billingEmail: data.invoice.billing_email, taxEnabled: data.invoice.tax_enabled, taxName: data.invoice.tax_name, taxRegistrationNumber: data.invoice.tax_registration_number, taxRatePercent: data.invoice.tax_rate_percent, paymentTermsDays: data.invoice.payment_terms_days, paymentInstructions: data.invoice.payment_instructions }) : null);
  const initial = { legalName: settings?.legalName ?? context.organization.organizationName, legalAddress: settings?.legalAddress ?? "", billingEmail: settings?.billingEmail ?? "", taxEnabled: settings?.taxEnabled ?? false, taxName: settings?.taxName ?? "VAT", taxRegistrationNumber: settings?.taxRegistrationNumber ?? "", taxRatePercent: settings?.taxRatePercent ?? "0", paymentTermsDays: settings?.paymentTermsDays ?? 30, paymentInstructions: settings?.paymentInstructions ?? "" };
  return <div className="mx-auto max-w-5xl space-y-5"><Link href="/settings/workflow" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> Settings</Link><header><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Organization settings</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Invoicing</h1><p className="mt-1 text-sm text-[#747977]">Set the legal, tax, and payment details copied into issued client invoices.</p></header><InvoiceSettingsForm initial={initial} /></div>;
}
