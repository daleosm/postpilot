ALTER TABLE "budget_lines"
  ADD COLUMN "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL,
  ADD COLUMN "external_cost" boolean DEFAULT false NOT NULL;

UPDATE "budget_lines"
SET "external_cost" = true
WHERE "vendor_invoice_id" IS NOT NULL;

CREATE INDEX "budget_lines_org_purchase_order_idx"
  ON "budget_lines" ("organization_id", "purchase_order_id");

CREATE UNIQUE INDEX "purchase_order_allocations_org_budget_line_idx"
  ON "purchase_order_allocations" ("organization_id", "budget_line_id");
