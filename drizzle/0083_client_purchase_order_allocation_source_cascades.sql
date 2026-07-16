ALTER TABLE "client_purchase_order_allocations" DROP CONSTRAINT IF EXISTS "client_purchase_order_allocations_billable_id_billables_id_fk";
ALTER TABLE "client_purchase_order_allocations" ADD CONSTRAINT "client_purchase_order_allocations_billable_id_billables_id_fk" FOREIGN KEY ("billable_id") REFERENCES "billables"("id") ON DELETE CASCADE;

ALTER TABLE "client_purchase_order_allocations" DROP CONSTRAINT IF EXISTS "client_purchase_order_allocations_client_invoice_id_client_invoices_id_fk";
ALTER TABLE "client_purchase_order_allocations" ADD CONSTRAINT "client_purchase_order_allocations_client_invoice_id_client_invoices_id_fk" FOREIGN KEY ("client_invoice_id") REFERENCES "client_invoices"("id") ON DELETE CASCADE;

ALTER TABLE "client_purchase_order_allocations" DROP CONSTRAINT IF EXISTS "client_purchase_order_allocations_client_invoice_item_id_client_invoice_items_id_fk";
ALTER TABLE "client_purchase_order_allocations" ADD CONSTRAINT "client_purchase_order_allocations_client_invoice_item_id_client_invoice_items_id_fk" FOREIGN KEY ("client_invoice_item_id") REFERENCES "client_invoice_items"("id") ON DELETE CASCADE;
