CREATE TYPE "show_contact_responsibility" AS ENUM ('creative_approvals', 'delivery_qc', 'finance_po', 'legal_compliance');
ALTER TABLE "show_contacts" ADD COLUMN "responsibility" "show_contact_responsibility" DEFAULT 'creative_approvals' NOT NULL;
CREATE UNIQUE INDEX "show_contacts_show_responsibility_idx" ON "show_contacts" USING btree ("show_id", "responsibility");
