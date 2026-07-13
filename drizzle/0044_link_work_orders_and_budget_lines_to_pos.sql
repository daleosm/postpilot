ALTER TABLE "post_work_orders" ADD COLUMN "vendor_company_id" uuid REFERENCES "crm_companies"("id") ON DELETE SET NULL;
ALTER TABLE "post_work_orders" ADD COLUMN "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL;
ALTER TABLE "budget_lines" ADD COLUMN "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL;
