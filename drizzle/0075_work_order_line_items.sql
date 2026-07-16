CREATE TYPE "work_order_item_type" AS ENUM ('service', 'material', 'expense');

CREATE TABLE "post_work_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "work_order_id" uuid NOT NULL REFERENCES "post_work_orders"("id") ON DELETE CASCADE,
  "type" "work_order_item_type" DEFAULT 'service' NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(12,2) DEFAULT '1' NOT NULL,
  "unit" text DEFAULT 'unit' NOT NULL,
  "unit_rate" numeric(14,2) DEFAULT '0' NOT NULL,
  "discount_percent" numeric(7,3) DEFAULT '0' NOT NULL,
  "notes" text,
  "position" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "post_work_order_items_org_work_order_idx"
  ON "post_work_order_items" ("organization_id", "work_order_id");
