ALTER TABLE "shows" ADD COLUMN "client_company_id" uuid REFERENCES "crm_companies"("id") ON DELETE set null;
ALTER TABLE "shows" ADD COLUMN "production_company_id" uuid REFERENCES "crm_companies"("id") ON DELETE set null;
ALTER TABLE "bookings" ADD COLUMN "client_contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE set null;
CREATE INDEX "shows_client_company_idx" ON "shows" ("client_company_id");
CREATE INDEX "bookings_client_contact_idx" ON "bookings" ("client_contact_id");
