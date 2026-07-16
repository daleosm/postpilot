ALTER TABLE "client_purchase_order_allocations"
  ADD COLUMN IF NOT EXISTS "overrun_authorised" boolean DEFAULT false NOT NULL;
