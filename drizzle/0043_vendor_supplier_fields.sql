ALTER TABLE "crm_companies" ADD COLUMN "service_category" text;
ALTER TABLE "crm_companies" ADD COLUMN "is_preferred_supplier" boolean DEFAULT false NOT NULL;
CREATE INDEX "crm_companies_org_service_idx" ON "crm_companies" USING btree ("organization_id", "service_category");
