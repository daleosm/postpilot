-- Purchase orders are no longer part of PostPilot's workflow or finance model.
-- This intentionally removes legacy PO records and their allocation references.
ALTER TABLE IF EXISTS "post_work_orders" DROP COLUMN IF EXISTS "purchase_order_id";
ALTER TABLE IF EXISTS "budget_lines" DROP COLUMN IF EXISTS "purchase_order_id";
ALTER TABLE IF EXISTS "billables" DROP COLUMN IF EXISTS "purchase_order_id";
ALTER TABLE IF EXISTS "vendor_invoices" DROP COLUMN IF EXISTS "purchase_order_id";

DROP TABLE IF EXISTS "purchase_order_events";
DROP TABLE IF EXISTS "purchase_orders";
DROP TYPE IF EXISTS "purchase_order_kind";

-- "finance_po" was only a PO-specific contact purpose. Preserve the same contacts
-- while giving the purpose its current finance-and-billing meaning.
ALTER TABLE "show_contacts" ALTER COLUMN "responsibility" DROP DEFAULT;
ALTER TYPE "show_contact_responsibility" RENAME TO "show_contact_responsibility_old";
CREATE TYPE "show_contact_responsibility" AS ENUM ('creative_approvals', 'delivery_qc', 'finance_billing', 'legal_compliance');
ALTER TABLE "show_contacts"
  ALTER COLUMN "responsibility" TYPE "show_contact_responsibility"
  USING (CASE "responsibility"::text WHEN 'finance_po' THEN 'finance_billing' ELSE "responsibility"::text END)::"show_contact_responsibility";
ALTER TABLE "show_contacts" ALTER COLUMN "responsibility" SET DEFAULT 'creative_approvals'::"show_contact_responsibility";
DROP TYPE "show_contact_responsibility_old";
