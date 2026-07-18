CREATE TYPE "delivery_workflow_gate" AS ENUM ('none', 'facility_dispatch', 'client_acceptance');
--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD COLUMN "delivery_gate" "delivery_workflow_gate" DEFAULT 'none' NOT NULL;
--> statement-breakpoint
UPDATE "workflow_stages" SET "delivery_gate" = 'facility_dispatch' WHERE "key" = 'delivery';
--> statement-breakpoint
UPDATE "workflow_stages" SET "delivery_gate" = 'client_acceptance' WHERE "key" = 'client_network_acceptance';
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_workflow_delivery_gate_idx" ON "workflow_stages" USING btree ("workflow_id", "delivery_gate") WHERE "delivery_gate" <> 'none';
--> statement-breakpoint
CREATE INDEX "workflow_stages_organization_delivery_gate_idx" ON "workflow_stages" USING btree ("organization_id", "delivery_gate");
--> statement-breakpoint
ALTER TYPE "work_order_kind" ADD VALUE IF NOT EXISTS 'delivery_correction';
--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "delivery_item_id" uuid REFERENCES "episode_delivery_items"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "post_work_orders_org_delivery_item_idx" ON "post_work_orders" USING btree ("organization_id", "delivery_item_id");
--> statement-breakpoint
CREATE TABLE "episode_delivery_acceptance_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE cascade,
  "workflow_stage_id" uuid NOT NULL REFERENCES "workflow_stages"("id") ON DELETE cascade,
  "reason" text NOT NULL,
  "authorised_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "authorised_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "episode_delivery_acceptance_exception_episode_stage_idx" ON "episode_delivery_acceptance_exceptions" USING btree ("episode_id", "workflow_stage_id");
--> statement-breakpoint
CREATE INDEX "episode_delivery_acceptance_exception_org_episode_idx" ON "episode_delivery_acceptance_exceptions" USING btree ("organization_id", "episode_id");
--> statement-breakpoint
UPDATE "organization_role_policies"
SET "permissions" = "permissions" || '["authorize_delivery_exceptions"]'::jsonb,
    "updated_at" = now()
WHERE "permissions" ? 'waive_qc'
  AND NOT "permissions" ? 'authorize_delivery_exceptions';
