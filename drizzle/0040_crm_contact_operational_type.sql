CREATE TYPE "crm_contact_type" AS ENUM ('general', 'creative_approval', 'technical_delivery', 'finance', 'legal', 'client_review');
ALTER TABLE "crm_contacts" ADD COLUMN "contact_type" "crm_contact_type" DEFAULT 'general' NOT NULL;
CREATE INDEX "crm_contacts_org_type_idx" ON "crm_contacts" USING btree ("organization_id", "contact_type");
