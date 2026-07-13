ALTER TABLE "crm_companies"
  ADD COLUMN "account_owner_id" uuid REFERENCES "people"("id") ON DELETE SET NULL,
  ADD COLUMN "next_action" text,
  ADD COLUMN "next_action_due_at" date;

CREATE INDEX "crm_companies_org_owner_idx"
  ON "crm_companies" USING btree ("organization_id", "account_owner_id");

CREATE INDEX "crm_companies_org_next_action_idx"
  ON "crm_companies" USING btree ("organization_id", "next_action_due_at");
