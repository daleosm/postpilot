ALTER TABLE "delivery_profile_items" ADD COLUMN "requires_external_recipient" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "episode_delivery_items" ADD COLUMN "requires_external_recipient" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "episode_delivery_items" ADD COLUMN "recipient_snapshot_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "episode_delivery_items_org_recipient_required_idx" ON "episode_delivery_items" USING btree ("organization_id", "recipient_contact_id", "requires_external_recipient");
