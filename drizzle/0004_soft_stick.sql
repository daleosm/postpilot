CREATE TYPE "public"."availability_status" AS ENUM('available', 'limited', 'booked_out', 'away');--> statement-breakpoint
CREATE TYPE "public"."cost_type" AS ENUM('billable', 'internal');--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "cost_type" "cost_type" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "availability" "availability_status" DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "hourly_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "day_rate" numeric(10, 2);