ALTER TABLE "client_shares" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliverables" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_requirements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_cut_approvals" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_cuts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_notes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "organization_role_policies"
SET "permissions" = (
  SELECT COALESCE(jsonb_agg(permission), '[]'::jsonb)
  FROM jsonb_array_elements_text("permissions") AS permission
  WHERE permission NOT IN ('update_notes', 'manage_deliverables')
)
WHERE "permissions" ?| ARRAY['update_notes', 'manage_deliverables'];--> statement-breakpoint
UPDATE "budget_lines" SET "category" = 'Finalisation' WHERE lower("category") = 'deliverables';--> statement-breakpoint
DELETE FROM "activity_log" WHERE "entity_type" IN ('review_cut', 'deliverable') OR "action" LIKE 'review.%' OR "action" LIKE 'delivery.%';--> statement-breakpoint
DROP TABLE "client_shares";--> statement-breakpoint
DROP TABLE "delivery_requirements";--> statement-breakpoint
DROP TABLE "review_cut_approvals";--> statement-breakpoint
DROP TABLE "review_notes";--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" DROP COLUMN "review_cut_id";--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" DROP COLUMN "source_review_cut_id";--> statement-breakpoint
ALTER TABLE "qc_reports" DROP COLUMN "deliverable_id";--> statement-breakpoint
ALTER TABLE "qc_reports" DROP COLUMN "review_cut_id";--> statement-breakpoint
DROP TRIGGER IF EXISTS "workflow_approvals_tenant_links" ON "episode_workflow_approvals";--> statement-breakpoint
CREATE TRIGGER "workflow_approvals_tenant_links" BEFORE INSERT OR UPDATE ON "episode_workflow_approvals" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'workflow_stage_id', 'workflow_stages', 'approval_rule_id', 'workflow_stage_approval_rules', 'required_person_id', 'people', 'approver_person_id', 'people');--> statement-breakpoint
DROP TRIGGER IF EXISTS "workflow_tracks_tenant_links" ON "episode_workflow_tracks";--> statement-breakpoint
CREATE TRIGGER "workflow_tracks_tenant_links" BEFORE INSERT OR UPDATE ON "episode_workflow_tracks" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'workflow_stage_id', 'workflow_stages');--> statement-breakpoint
DROP TRIGGER IF EXISTS "qc_reports_tenant_links" ON "qc_reports";--> statement-breakpoint
CREATE TRIGGER "qc_reports_tenant_links" BEFORE INSERT OR UPDATE ON "qc_reports" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'waived_by_person_id', 'people');--> statement-breakpoint
DROP TABLE "deliverables";--> statement-breakpoint
DROP TABLE "review_cuts";--> statement-breakpoint
DROP TYPE "public"."deliverable_status";--> statement-breakpoint
DROP TYPE "public"."note_priority";--> statement-breakpoint
DROP TYPE "public"."note_status";--> statement-breakpoint
DROP TYPE "public"."review_status";
