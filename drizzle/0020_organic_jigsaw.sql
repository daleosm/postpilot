-- Remove the retired Tasks capability from saved tenant role policies before
-- the permission disappears from the application contract.
UPDATE "organization_role_policies"
SET "permissions" = (
  SELECT COALESCE(jsonb_agg(permission), '[]'::jsonb)
  FROM jsonb_array_elements_text("permissions") AS permission
  WHERE permission <> 'update_tasks'
)
WHERE "permissions" ? 'update_tasks';--> statement-breakpoint

DROP TABLE "tasks" CASCADE;--> statement-breakpoint
DROP TYPE "public"."task_priority";--> statement-breakpoint
DROP TYPE "public"."task_status";
