CREATE TYPE "crm_account_status" AS ENUM ('active', 'on_hold', 'inactive');
ALTER TABLE "crm_companies" ADD COLUMN "currency" text DEFAULT 'GBP' NOT NULL;
ALTER TABLE "crm_companies" ADD COLUMN "finance_email" text;
ALTER TABLE "crm_companies" ADD COLUMN "account_status" "crm_account_status" DEFAULT 'active' NOT NULL;
CREATE INDEX "crm_companies_org_status_idx" ON "crm_companies" USING btree ("organization_id", "account_status");
