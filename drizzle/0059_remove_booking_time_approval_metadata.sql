-- Custom SQL migration file, put your code below! --
-- Actual booking time now applies immediately; the previous reviewer workflow
-- is no longer part of the product. Keep the submission rows as audit records.
DROP INDEX IF EXISTS "booking_time_submissions_organization_status_idx";
ALTER TABLE "booking_time_submissions"
  DROP COLUMN IF EXISTS "reviewed_at",
  DROP COLUMN IF EXISTS "reviewed_by_person_id",
  DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "booking_time_approval_status";
