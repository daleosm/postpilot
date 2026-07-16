ALTER TABLE "billables" ADD COLUMN "client_purchase_order_id" uuid REFERENCES "client_purchase_orders"("id") ON DELETE SET NULL;
ALTER TABLE "client_invoice_items" ADD COLUMN "client_purchase_order_id" uuid REFERENCES "client_purchase_orders"("id") ON DELETE SET NULL;
ALTER TABLE "client_purchase_order_allocations" ADD COLUMN "client_invoice_item_id" uuid REFERENCES "client_invoice_items"("id") ON DELETE SET NULL;

CREATE INDEX "billables_org_client_purchase_order_idx" ON "billables" ("organization_id", "client_purchase_order_id");
CREATE INDEX "client_invoice_items_org_client_purchase_order_idx" ON "client_invoice_items" ("organization_id", "client_purchase_order_id");
CREATE UNIQUE INDEX "client_po_allocations_po_invoice_item_idx" ON "client_purchase_order_allocations" ("client_purchase_order_id", "client_invoice_item_id");

ALTER TABLE "client_purchase_order_allocations" DROP CONSTRAINT "client_purchase_order_allocations_source_check";
ALTER TABLE "client_purchase_order_allocations" ADD CONSTRAINT "client_purchase_order_allocations_source_check" CHECK (
  ("allocation_type" = 'billable' AND "billable_id" IS NOT NULL AND "client_invoice_id" IS NULL AND "client_invoice_item_id" IS NULL AND "change_order_reference" IS NULL)
  OR ("allocation_type" = 'client_invoice' AND "billable_id" IS NULL AND "change_order_reference" IS NULL AND (("client_invoice_id" IS NOT NULL AND "client_invoice_item_id" IS NULL) OR ("client_invoice_id" IS NULL AND "client_invoice_item_id" IS NOT NULL)))
  OR ("allocation_type" = 'change_order' AND "billable_id" IS NULL AND "client_invoice_id" IS NULL AND "client_invoice_item_id" IS NULL AND "change_order_reference" IS NOT NULL)
);
