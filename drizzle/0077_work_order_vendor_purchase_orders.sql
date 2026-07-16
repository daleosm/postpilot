CREATE TYPE "work_order_work_type" AS ENUM ('internal', 'external_vendor');

ALTER TABLE "post_work_orders"
  ADD COLUMN "work_type" "work_order_work_type" DEFAULT 'internal' NOT NULL,
  ADD COLUMN "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL;

UPDATE "post_work_orders" SET "work_type" = 'external_vendor' WHERE "vendor_company_id" IS NOT NULL;

CREATE INDEX "post_work_orders_org_purchase_order_idx"
  ON "post_work_orders" ("organization_id", "purchase_order_id");
