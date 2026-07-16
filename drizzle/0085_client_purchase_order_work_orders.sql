ALTER TABLE "post_work_orders" ADD COLUMN "client_purchase_order_id" uuid REFERENCES "client_purchase_orders"("id") ON DELETE SET NULL;
CREATE INDEX "post_work_orders_org_client_purchase_order_idx" ON "post_work_orders" ("organization_id", "client_purchase_order_id");
