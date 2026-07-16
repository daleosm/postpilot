import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { invoiceSettings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const nullableText = z.string().trim().max(2000).nullable().optional();
const schema = z.object({
  legalName: z.string().trim().min(1).max(180),
  legalAddress: nullableText,
  billingEmail: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
  taxName: z.string().trim().min(1).max(40),
  taxRegistrationNumber: z.string().trim().max(120).nullable().optional(),
  taxRatePercent: z.coerce.number().min(0).max(100).finite(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  paymentInstructions: nullableText,
});

export async function PATCH(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the invoicing settings." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const value = parsed.data;
  await getDb().insert(invoiceSettings).values({
    organizationId: context.organization.organizationId,
    legalName: value.legalName,
    legalAddress: emptyToNull(value.legalAddress),
    billingEmail: emptyToNull(value.billingEmail),
    taxName: value.taxName,
    taxRegistrationNumber: emptyToNull(value.taxRegistrationNumber),
    taxRatePercent: String(value.taxRatePercent),
    paymentTermsDays: value.paymentTermsDays,
    paymentInstructions: emptyToNull(value.paymentInstructions),
  }).onConflictDoUpdate({ target: invoiceSettings.organizationId, set: {
    legalName: value.legalName,
    legalAddress: emptyToNull(value.legalAddress),
    billingEmail: emptyToNull(value.billingEmail),
    taxName: value.taxName,
    taxRegistrationNumber: emptyToNull(value.taxRegistrationNumber),
    taxRatePercent: String(value.taxRatePercent),
    paymentTermsDays: value.paymentTermsDays,
    paymentInstructions: emptyToNull(value.paymentInstructions),
    updatedAt: new Date(),
  } });
  return NextResponse.json({ ok: true });
}

function emptyToNull(value: string | null | undefined) { return value?.trim() || null; }
