-- A billable or direct invoice source may be committed to only one client PO
-- inside a tenant. NULL values remain valid for the other ledger source types.
CREATE UNIQUE INDEX "client_po_allocations_org_billable_idx"
  ON "client_purchase_order_allocations" USING btree ("organization_id", "billable_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "client_po_allocations_org_invoice_idx"
  ON "client_purchase_order_allocations" USING btree ("organization_id", "client_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "client_po_allocations_org_invoice_item_idx"
  ON "client_purchase_order_allocations" USING btree ("organization_id", "client_invoice_item_id");
