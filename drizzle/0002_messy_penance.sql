CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."note_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
ALTER TABLE "review_cuts" ADD COLUMN "runtime_seconds" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "review_cuts" ADD COLUMN "approval_status" "approval_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_notes" ADD COLUMN "department" text DEFAULT 'Editorial' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_notes" ADD COLUMN "priority" "note_priority" DEFAULT 'normal' NOT NULL;