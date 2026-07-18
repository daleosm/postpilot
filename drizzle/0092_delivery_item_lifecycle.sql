ALTER TYPE "delivery_item_status" ADD VALUE IF NOT EXISTS 'preparing' AFTER 'not_started';
--> statement-breakpoint
ALTER TYPE "delivery_item_status" ADD VALUE IF NOT EXISTS 'dispatched' BEFORE 'receipt_confirmed';
--> statement-breakpoint
UPDATE "episode_delivery_items" SET "status" = 'preparing' WHERE "status" = 'in_progress';
--> statement-breakpoint
UPDATE "episode_delivery_items" SET "status" = 'dispatched' WHERE "status" = 'submitted';
--> statement-breakpoint
ALTER TABLE "episode_delivery_items" ADD COLUMN "waiver_reason" text;
