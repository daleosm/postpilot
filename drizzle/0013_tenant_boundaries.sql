-- Promote derived operational records to explicit tenant records. Columns are
-- backfilled before becoming mandatory so existing post-house data is retained.
ALTER TABLE "delivery_requirements" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "qc_issues" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "review_cut_approvals" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "review_notes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "show_team_assignments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_stage_approval_rules" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD COLUMN "organization_id" uuid;--> statement-breakpoint

UPDATE "seasons" AS child SET "organization_id" = parent."organization_id" FROM "shows" AS parent WHERE child."show_id" = parent."id";--> statement-breakpoint
UPDATE "workflow_stages" AS child SET "organization_id" = parent."organization_id" FROM "post_workflows" AS parent WHERE child."workflow_id" = parent."id";--> statement-breakpoint
UPDATE "workflow_stage_approval_rules" AS child SET "organization_id" = parent."organization_id" FROM "workflow_stages" AS parent WHERE child."workflow_stage_id" = parent."id";--> statement-breakpoint
UPDATE "episodes" AS child SET "organization_id" = parent."organization_id" FROM "seasons" AS parent WHERE child."season_id" = parent."id";--> statement-breakpoint
UPDATE "show_team_assignments" AS child SET "organization_id" = parent."organization_id" FROM "shows" AS parent WHERE child."show_id" = parent."id";--> statement-breakpoint
UPDATE "episode_workflow_approvals" AS child SET "organization_id" = parent."organization_id" FROM "episodes" AS parent WHERE child."episode_id" = parent."id";--> statement-breakpoint
UPDATE "episode_workflow_tracks" AS child SET "organization_id" = parent."organization_id" FROM "episodes" AS parent WHERE child."episode_id" = parent."id";--> statement-breakpoint
UPDATE "review_cut_approvals" AS child SET "organization_id" = parent."organization_id" FROM "review_cuts" AS parent WHERE child."review_cut_id" = parent."id";--> statement-breakpoint
UPDATE "review_notes" AS child SET "organization_id" = parent."organization_id" FROM "review_cuts" AS parent WHERE child."review_cut_id" = parent."id";--> statement-breakpoint
UPDATE "delivery_requirements" AS child SET "organization_id" = parent."organization_id" FROM "deliverables" AS parent WHERE child."deliverable_id" = parent."id";--> statement-breakpoint
UPDATE "qc_issues" AS child SET "organization_id" = parent."organization_id" FROM "qc_reports" AS parent WHERE child."qc_report_id" = parent."id";--> statement-breakpoint

DO $$
DECLARE missing_table text;
BEGIN
  SELECT table_name INTO missing_table FROM (
    SELECT 'delivery_requirements' AS table_name, count(*) AS missing FROM "delivery_requirements" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'episode_workflow_approvals', count(*) FROM "episode_workflow_approvals" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'episode_workflow_tracks', count(*) FROM "episode_workflow_tracks" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'episodes', count(*) FROM "episodes" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'qc_issues', count(*) FROM "qc_issues" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'review_cut_approvals', count(*) FROM "review_cut_approvals" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'review_notes', count(*) FROM "review_notes" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'seasons', count(*) FROM "seasons" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'show_team_assignments', count(*) FROM "show_team_assignments" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'workflow_stage_approval_rules', count(*) FROM "workflow_stage_approval_rules" WHERE "organization_id" IS NULL
    UNION ALL SELECT 'workflow_stages', count(*) FROM "workflow_stages" WHERE "organization_id" IS NULL
  ) AS missing_rows WHERE missing > 0 LIMIT 1;
  IF missing_table IS NOT NULL THEN RAISE EXCEPTION 'Could not derive tenant for %', missing_table; END IF;
END $$;--> statement-breakpoint

ALTER TABLE "delivery_requirements" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_issues" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_cut_approvals" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_notes" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "show_team_assignments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_stage_approval_rules" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_stages" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "delivery_requirements" ADD CONSTRAINT "delivery_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD CONSTRAINT "episode_workflow_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" ADD CONSTRAINT "episode_workflow_tracks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "qc_issues" ADD CONSTRAINT "qc_issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "review_cut_approvals" ADD CONSTRAINT "review_cut_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "show_team_assignments" ADD CONSTRAINT "show_team_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_stage_approval_rules" ADD CONSTRAINT "workflow_stage_approval_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint

CREATE INDEX "delivery_requirements_organization_id_idx" ON "delivery_requirements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "episode_workflow_approvals_organization_id_idx" ON "episode_workflow_approvals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "episode_workflow_tracks_organization_id_idx" ON "episode_workflow_tracks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "episodes_organization_id_idx" ON "episodes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "qc_issues_organization_id_idx" ON "qc_issues" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "review_cut_approvals_organization_id_idx" ON "review_cut_approvals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "review_notes_organization_id_idx" ON "review_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "seasons_organization_id_idx" ON "seasons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "show_team_assignments_organization_id_idx" ON "show_team_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflow_stage_approval_rules_organization_id_idx" ON "workflow_stage_approval_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflow_stages_organization_id_idx" ON "workflow_stages" USING btree ("organization_id");--> statement-breakpoint

-- Existing foreign keys guarantee that references exist. This reusable trigger
-- guarantees every referenced operational record belongs to the same tenant.
CREATE OR REPLACE FUNCTION "public"."postpilot_enforce_tenant_links"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  expected_organization uuid := (to_jsonb(NEW)->>'organization_id')::uuid;
  reference_id uuid;
  reference_organization uuid;
  i integer;
BEGIN
  IF expected_organization IS NULL THEN RAISE EXCEPTION 'organization_id is required for %', TG_TABLE_NAME; END IF;
  FOR i IN 0..TG_NARGS - 1 BY 2 LOOP
    reference_id := NULLIF(row_data ->> TG_ARGV[i], '')::uuid;
    IF reference_id IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', TG_ARGV[i + 1]) INTO reference_organization USING reference_id;
    IF reference_organization IS DISTINCT FROM expected_organization THEN
      RAISE EXCEPTION 'tenant mismatch on %.% -> %', TG_TABLE_NAME, TG_ARGV[i], TG_ARGV[i + 1] USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "post_workflows_tenant_links" BEFORE INSERT OR UPDATE ON "post_workflows" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('show_id', 'shows');--> statement-breakpoint
CREATE TRIGGER "seasons_tenant_links" BEFORE INSERT OR UPDATE ON "seasons" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('show_id', 'shows');--> statement-breakpoint
CREATE TRIGGER "workflow_stages_tenant_links" BEFORE INSERT OR UPDATE ON "workflow_stages" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('workflow_id', 'post_workflows');--> statement-breakpoint
CREATE TRIGGER "workflow_rules_tenant_links" BEFORE INSERT OR UPDATE ON "workflow_stage_approval_rules" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('workflow_stage_id', 'workflow_stages');--> statement-breakpoint
CREATE TRIGGER "show_team_tenant_links" BEFORE INSERT OR UPDATE ON "show_team_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('show_id', 'shows', 'person_id', 'people');--> statement-breakpoint
CREATE TRIGGER "episodes_tenant_links" BEFORE INSERT OR UPDATE ON "episodes" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('season_id', 'seasons', 'workflow_stage_id', 'workflow_stages', 'assigned_producer_id', 'people', 'editor_id', 'people', 'colorist_id', 'people', 'sound_mixer_id', 'people');--> statement-breakpoint
CREATE TRIGGER "bookings_tenant_links" BEFORE INSERT OR UPDATE ON "bookings" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('room_id', 'rooms', 'episode_id', 'episodes', 'person_id', 'people');--> statement-breakpoint
CREATE TRIGGER "catering_tenant_links" BEFORE INSERT OR UPDATE ON "catering_requests" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('booking_id', 'bookings', 'room_id', 'rooms', 'requested_by_person_id', 'people', 'fulfilled_by_person_id', 'people');--> statement-breakpoint
CREATE TRIGGER "tasks_tenant_links" BEFORE INSERT OR UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('show_id', 'shows', 'episode_id', 'episodes', 'workflow_stage_id', 'workflow_stages', 'assignee_id', 'people');--> statement-breakpoint
CREATE TRIGGER "review_cuts_tenant_links" BEFORE INSERT OR UPDATE ON "review_cuts" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes');--> statement-breakpoint
CREATE TRIGGER "review_cut_approvals_tenant_links" BEFORE INSERT OR UPDATE ON "review_cut_approvals" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('review_cut_id', 'review_cuts', 'approver_person_id', 'people');--> statement-breakpoint
CREATE TRIGGER "review_notes_tenant_links" BEFORE INSERT OR UPDATE ON "review_notes" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('review_cut_id', 'review_cuts');--> statement-breakpoint
CREATE TRIGGER "deliverables_tenant_links" BEFORE INSERT OR UPDATE ON "deliverables" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes');--> statement-breakpoint
CREATE TRIGGER "delivery_requirements_tenant_links" BEFORE INSERT OR UPDATE ON "delivery_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('deliverable_id', 'deliverables');--> statement-breakpoint
CREATE TRIGGER "qc_reports_tenant_links" BEFORE INSERT OR UPDATE ON "qc_reports" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'deliverable_id', 'deliverables', 'review_cut_id', 'review_cuts', 'waived_by_person_id', 'people');--> statement-breakpoint
CREATE TRIGGER "qc_issues_tenant_links" BEFORE INSERT OR UPDATE ON "qc_issues" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('qc_report_id', 'qc_reports');--> statement-breakpoint
CREATE TRIGGER "client_shares_tenant_links" BEFORE INSERT OR UPDATE ON "client_shares" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('client_person_id', 'people', 'show_id', 'shows', 'episode_id', 'episodes', 'review_cut_id', 'review_cuts', 'deliverable_id', 'deliverables');--> statement-breakpoint
CREATE TRIGGER "budget_lines_tenant_links" BEFORE INSERT OR UPDATE ON "budget_lines" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('show_id', 'shows', 'season_id', 'seasons', 'episode_id', 'episodes');--> statement-breakpoint
CREATE TRIGGER "billables_tenant_links" BEFORE INSERT OR UPDATE ON "billables" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('show_id', 'shows', 'episode_id', 'episodes');--> statement-breakpoint
CREATE TRIGGER "workflow_approvals_tenant_links" BEFORE INSERT OR UPDATE ON "episode_workflow_approvals" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'workflow_stage_id', 'workflow_stages', 'review_cut_id', 'review_cuts', 'approval_rule_id', 'workflow_stage_approval_rules', 'required_person_id', 'people', 'approver_person_id', 'people');--> statement-breakpoint
CREATE TRIGGER "workflow_tracks_tenant_links" BEFORE INSERT OR UPDATE ON "episode_workflow_tracks" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'workflow_stage_id', 'workflow_stages', 'source_review_cut_id', 'review_cuts');
