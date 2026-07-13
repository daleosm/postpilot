CREATE TYPE "crm_booking_clearance" AS ENUM ('clear', 'po_required', 'finance_approval', 'on_hold');

ALTER TABLE "crm_companies"
  ADD COLUMN "booking_clearance" "crm_booking_clearance" DEFAULT 'clear' NOT NULL;

CREATE INDEX "crm_companies_org_booking_clearance_idx"
  ON "crm_companies" USING btree ("organization_id", "booking_clearance");
