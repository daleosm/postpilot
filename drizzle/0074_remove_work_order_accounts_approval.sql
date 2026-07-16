-- Financial posting is a Budget permission, not a separate work-order
-- Accounts approval. Preserve existing records by returning any queued charge
-- to its ready-to-post draft state before removing the obsolete enum value.
UPDATE "post_work_orders"
SET "billing_status" = 'draft'
WHERE "billing_status" = 'awaiting_finance';

ALTER TABLE "post_work_orders"
  ALTER COLUMN "billing_status" DROP DEFAULT;

CREATE TYPE "work_order_billing_status_next" AS ENUM ('not_billable', 'draft', 'posted', 'declined');

ALTER TABLE "post_work_orders"
  ALTER COLUMN "billing_status" TYPE "work_order_billing_status_next"
  USING "billing_status"::text::"work_order_billing_status_next";

DROP TYPE "work_order_billing_status";
ALTER TYPE "work_order_billing_status_next" RENAME TO "work_order_billing_status";

ALTER TABLE "post_work_orders"
  ALTER COLUMN "billing_status" SET DEFAULT 'not_billable';
