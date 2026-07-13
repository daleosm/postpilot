ALTER TABLE "vendor_invoices" ADD COLUMN "work_order_id" uuid REFERENCES "post_work_orders"("id") ON DELETE SET NULL;
CREATE INDEX "vendor_invoices_org_work_order_idx" ON "vendor_invoices" ("organization_id", "work_order_id");
