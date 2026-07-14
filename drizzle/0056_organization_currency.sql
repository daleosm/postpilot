ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'GBP' NOT NULL;

UPDATE "organizations" AS organization
SET "currency" = COALESCE((
  SELECT company."currency" FROM "crm_companies" AS company
  WHERE company."organization_id" = organization."id"
  ORDER BY company."created_at" ASC
  LIMIT 1
), 'GBP');

UPDATE "crm_companies" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "post_work_orders" AS record SET "currency" = organization."currency", "client_quote_currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "budget_lines" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "service_rates" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "rate_cards" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "billables" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "vendor_invoices" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
UPDATE "catering_requests" AS record SET "currency" = organization."currency" FROM "organizations" AS organization WHERE record."organization_id" = organization."id";
