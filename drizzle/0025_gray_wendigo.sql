CREATE TYPE "public"."work_order_billing_scope" AS ENUM('included', 'billable_change', 'internal');--> statement-breakpoint
CREATE TYPE "public"."work_order_billing_status" AS ENUM('not_billable', 'draft', 'awaiting_finance', 'posted', 'declined');--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "billing_scope" "work_order_billing_scope" DEFAULT 'included' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "billing_status" "work_order_billing_status" DEFAULT 'not_billable' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "estimated_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "actual_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD COLUMN "billing_notes" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_work_order_id_post_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."post_work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_work_order_id_idx" ON "budget_lines" USING btree ("work_order_id");