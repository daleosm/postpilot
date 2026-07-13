CREATE TYPE "booking_time_approval_status" AS ENUM ('pending', 'approved', 'rejected');
ALTER TABLE "bookings" ADD COLUMN "actual_starts_at" timestamp with time zone;
ALTER TABLE "bookings" ADD COLUMN "actual_ends_at" timestamp with time zone;
ALTER TABLE "bookings" ADD COLUMN "approved_overtime_minutes" integer DEFAULT 0 NOT NULL;
CREATE TABLE "booking_time_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade, "submitted_by_person_id" uuid NOT NULL REFERENCES "people"("id") ON DELETE cascade,
  "actual_starts_at" timestamp with time zone NOT NULL, "actual_ends_at" timestamp with time zone NOT NULL, "overtime_minutes" integer DEFAULT 0 NOT NULL,
  "note" text, "status" "booking_time_approval_status" DEFAULT 'pending' NOT NULL, "reviewed_by_person_id" uuid REFERENCES "people"("id") ON DELETE set null,
  "reviewed_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "booking_time_submissions_booking_idx" ON "booking_time_submissions" ("booking_id");
CREATE INDEX "booking_time_submissions_organization_status_idx" ON "booking_time_submissions" ("organization_id", "status");
