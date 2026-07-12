CREATE TYPE "public"."qc_issue_status" AS ENUM('open', 'resolved', 'waived');--> statement-breakpoint
CREATE TYPE "public"."qc_report_status" AS ENUM('draft', 'in_progress', 'passed', 'failed', 'waived');--> statement-breakpoint
CREATE TYPE "public"."workflow_track_status" AS ENUM('not_started', 'in_progress', 'submitted', 'approved', 'changes_requested', 'blocked');--> statement-breakpoint
CREATE TABLE "client_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_person_id" uuid NOT NULL,
	"show_id" uuid,
	"episode_id" uuid,
	"review_cut_id" uuid,
	"deliverable_id" uuid,
	"can_approve" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_workflow_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"status" "workflow_track_status" DEFAULT 'not_started' NOT NULL,
	"source_review_cut_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qc_report_id" uuid NOT NULL,
	"code" text,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"timecode_seconds" numeric(12, 3),
	"status" "qc_issue_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"review_cut_id" uuid,
	"status" "qc_report_status" DEFAULT 'draft' NOT NULL,
	"report_url" text,
	"checksum" text,
	"summary" text,
	"waiver_reason" text,
	"waived_by_person_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cut_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_cut_id" uuid NOT NULL,
	"approver_person_id" uuid,
	"approver_role" text NOT NULL,
	"decision" "approval_status" NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_requirements" ADD COLUMN "evidence_url" text;--> statement-breakpoint
ALTER TABLE "delivery_requirements" ADD COLUMN "checksum" text;--> statement-breakpoint
ALTER TABLE "delivery_requirements" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD COLUMN "review_cut_id" uuid;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "time_zone" text DEFAULT 'Europe/London' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_client_person_id_people_id_fk" FOREIGN KEY ("client_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_review_cut_id_review_cuts_id_fk" FOREIGN KEY ("review_cut_id") REFERENCES "public"."review_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" ADD CONSTRAINT "episode_workflow_tracks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" ADD CONSTRAINT "episode_workflow_tracks_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_workflow_tracks" ADD CONSTRAINT "episode_workflow_tracks_source_review_cut_id_review_cuts_id_fk" FOREIGN KEY ("source_review_cut_id") REFERENCES "public"."review_cuts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_issues" ADD CONSTRAINT "qc_issues_qc_report_id_qc_reports_id_fk" FOREIGN KEY ("qc_report_id") REFERENCES "public"."qc_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_review_cut_id_review_cuts_id_fk" FOREIGN KEY ("review_cut_id") REFERENCES "public"."review_cuts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_waived_by_person_id_people_id_fk" FOREIGN KEY ("waived_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cut_approvals" ADD CONSTRAINT "review_cut_approvals_review_cut_id_review_cuts_id_fk" FOREIGN KEY ("review_cut_id") REFERENCES "public"."review_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cut_approvals" ADD CONSTRAINT "review_cut_approvals_approver_person_id_people_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_shares_person_idx" ON "client_shares" USING btree ("client_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_workflow_tracks_episode_stage_idx" ON "episode_workflow_tracks" USING btree ("episode_id","workflow_stage_id");--> statement-breakpoint
CREATE INDEX "episode_workflow_tracks_stage_status_idx" ON "episode_workflow_tracks" USING btree ("workflow_stage_id","status");--> statement-breakpoint
CREATE INDEX "qc_issues_report_status_idx" ON "qc_issues" USING btree ("qc_report_id","status");--> statement-breakpoint
CREATE INDEX "qc_reports_episode_status_idx" ON "qc_reports" USING btree ("episode_id","status");--> statement-breakpoint
CREATE INDEX "review_cut_approvals_cut_idx" ON "review_cut_approvals" USING btree ("review_cut_id","decided_at");--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD CONSTRAINT "episode_workflow_approvals_review_cut_id_review_cuts_id_fk" FOREIGN KEY ("review_cut_id") REFERENCES "public"."review_cuts"("id") ON DELETE set null ON UPDATE no action;