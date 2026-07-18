CREATE TABLE "episode_delivery_manifest_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "episode_delivery_manifest_id" uuid NOT NULL REFERENCES "episode_delivery_manifests"("id") ON DELETE cascade,
  "person_id" uuid NOT NULL REFERENCES "people"("id") ON DELETE cascade,
  "shared_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "episode_delivery_manifest_shares_manifest_person_idx" ON "episode_delivery_manifest_shares" USING btree ("episode_delivery_manifest_id", "person_id");
--> statement-breakpoint
CREATE INDEX "episode_delivery_manifest_shares_org_person_idx" ON "episode_delivery_manifest_shares" USING btree ("organization_id", "person_id");
--> statement-breakpoint
ALTER TABLE "episode_delivery_items" ADD COLUMN "is_externally_shared" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "organization_role_policies"
SET "permissions" = "permissions" || '["view_shared_delivery_status"]'::jsonb,
    "updated_at" = now()
WHERE "role" = 'client'
  AND NOT "permissions" ? 'view_shared_delivery_status';
