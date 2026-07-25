ALTER TABLE "client_purchase_order_allocations"
  ADD COLUMN IF NOT EXISTS "work_order_id" uuid REFERENCES "post_work_orders"("id") ON DELETE CASCADE;

ALTER TABLE "client_purchase_order_allocations"
  DROP CONSTRAINT IF EXISTS "client_purchase_order_allocations_source_check";

ALTER TABLE "client_purchase_order_allocations"
  ADD CONSTRAINT "client_purchase_order_allocations_source_check" CHECK (
    (
      "allocation_type" = 'billable'
      AND "billable_id" IS NOT NULL
      AND "client_invoice_id" IS NULL
      AND "client_invoice_item_id" IS NULL
      AND "work_order_id" IS NULL
      AND "change_order_reference" IS NULL
    )
    OR (
      "allocation_type" = 'client_invoice'
      AND "billable_id" IS NULL
      AND "work_order_id" IS NULL
      AND "change_order_reference" IS NULL
      AND (
        ("client_invoice_id" IS NOT NULL AND "client_invoice_item_id" IS NULL)
        OR ("client_invoice_id" IS NULL AND "client_invoice_item_id" IS NOT NULL)
      )
    )
    OR (
      "allocation_type" = 'change_order'
      AND "billable_id" IS NULL
      AND "client_invoice_id" IS NULL
      AND "client_invoice_item_id" IS NULL
      AND "work_order_id" IS NULL
      AND "change_order_reference" IS NOT NULL
    )
    OR (
      "allocation_type" = 'work_order'
      AND "billable_id" IS NULL
      AND "client_invoice_id" IS NULL
      AND "client_invoice_item_id" IS NULL
      AND "work_order_id" IS NOT NULL
      AND "change_order_reference" IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "client_po_allocations_po_work_order_idx"
  ON "client_purchase_order_allocations" ("client_purchase_order_id", "work_order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "client_po_allocations_org_work_order_idx"
  ON "client_purchase_order_allocations" ("organization_id", "work_order_id");
