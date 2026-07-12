CREATE TYPE "public"."asset_status" AS ENUM('active', 'review', 'approved', 'archived', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."deliverable_status" ADD VALUE 'ready_for_qc' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."deliverable_status" ADD VALUE 'failed_qc' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."deliverable_status" ADD VALUE 'approved' BEFORE 'delivered';--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "status" "asset_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "notes" text;