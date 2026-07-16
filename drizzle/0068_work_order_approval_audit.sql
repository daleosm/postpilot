ALTER TABLE "post_work_orders" ADD COLUMN IF NOT EXISTS "approved_by_person_id" uuid REFERENCES "people"("id") ON DELETE set null;
ALTER TABLE "post_work_orders" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
ALTER TABLE "post_work_orders" ADD COLUMN IF NOT EXISTS "approval_note" text;

UPDATE "organization_role_policies"
SET "permissions" = "permissions" || '["approve_work_orders"]'::jsonb
WHERE "role" IN ('post_supervisor', 'producer')
  AND NOT ("permissions" ? 'approve_work_orders');
