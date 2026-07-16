ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "tax_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "client_invoices" ADD COLUMN IF NOT EXISTS "tax_enabled" boolean DEFAULT false NOT NULL;

-- Preserve explicitly configured and previously issued tax documents; only new
-- post houses and invoices default to tax disabled.
UPDATE "invoice_settings"
SET "tax_enabled" = true
WHERE "tax_rate_percent" <> 0 OR "tax_registration_number" IS NOT NULL;

UPDATE "client_invoices"
SET "tax_enabled" = true
WHERE "tax_rate_percent" <> 0 OR "tax_amount" <> 0;
