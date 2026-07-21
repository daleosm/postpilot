ALTER TYPE "delivery_item_status" ADD VALUE IF NOT EXISTS 'preparing' AFTER 'not_started';
--> statement-breakpoint
ALTER TYPE "delivery_item_status" ADD VALUE IF NOT EXISTS 'dispatched' BEFORE 'receipt_confirmed';
--> statement-breakpoint
ALTER TABLE "episode_delivery_items" ADD COLUMN IF NOT EXISTS "waiver_reason" text;
