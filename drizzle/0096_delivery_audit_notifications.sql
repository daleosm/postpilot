ALTER TABLE "notifications" ALTER COLUMN "person_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "crm_contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "recipient_email" text;
--> statement-breakpoint
CREATE INDEX "notifications_contact_pending_idx" ON "notifications" USING btree ("crm_contact_id", "read_at");
