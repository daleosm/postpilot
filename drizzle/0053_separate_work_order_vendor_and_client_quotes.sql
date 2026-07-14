ALTER TABLE "post_work_orders"
  ADD COLUMN "client_quote_amount" numeric(14, 2),
  ADD COLUMN "client_quote_currency" text;
