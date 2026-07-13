CREATE TYPE "public"."work_order_kind" AS ENUM('work_order', 'qc_exception');--> statement-breakpoint
CREATE TYPE "public"."work_order_priority" AS ENUM('blocker', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('open', 'in_progress', 'ready_for_review', 'complete', 'cancelled');--> statement-breakpoint
UPDATE "organization_role_policies"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM (
    SELECT jsonb_array_elements_text("permissions") AS permission
    UNION ALL SELECT 'manage_work_orders'
    UNION ALL SELECT 'update_assigned_work'
  ) AS expanded
)
WHERE "role" IN ('post_supervisor', 'producer', 'head_of_production') OR "permissions" ? 'manage_reviews';--> statement-breakpoint
UPDATE "organization_role_policies"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM (
    SELECT jsonb_array_elements_text("permissions") AS permission
    UNION ALL SELECT 'update_assigned_work'
  ) AS expanded
)
WHERE "role" IN ('editor', 'assistant_editor', 'online_editor', 'colorist', 'sound_mixer', 'supervising_sound_editor', 'rerecording_mixer', 'qc', 'vfx_coordinator', 'vfx_supervisor');--> statement-breakpoint
CREATE TABLE "post_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"workflow_stage_id" uuid,
	"booking_id" uuid,
	"qc_issue_id" uuid,
	"kind" "work_order_kind" DEFAULT 'work_order' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"department" text,
	"assignee_person_id" uuid,
	"assignee_role" text,
	"priority" "work_order_priority" DEFAULT 'normal' NOT NULL,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"status" "work_order_status" DEFAULT 'open' NOT NULL,
	"external_url" text,
	"due_at" timestamp with time zone,
	"created_by_user_id" text,
	"completed_by_person_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stage_work_order_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"department" text,
	"assignee_role" text,
	"priority" "work_order_priority" DEFAULT 'normal' NOT NULL,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_qc_issue_id_qc_issues_id_fk" FOREIGN KEY ("qc_issue_id") REFERENCES "public"."qc_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_assignee_person_id_people_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_work_orders" ADD CONSTRAINT "post_work_orders_completed_by_person_id_people_id_fk" FOREIGN KEY ("completed_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_work_order_templates" ADD CONSTRAINT "workflow_stage_work_order_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_work_order_templates" ADD CONSTRAINT "workflow_stage_work_order_templates_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_work_orders_qc_issue_idx" ON "post_work_orders" USING btree ("qc_issue_id");--> statement-breakpoint
CREATE INDEX "post_work_orders_org_assignee_status_idx" ON "post_work_orders" USING btree ("organization_id","assignee_person_id","status");--> statement-breakpoint
CREATE INDEX "post_work_orders_episode_status_idx" ON "post_work_orders" USING btree ("episode_id","status");--> statement-breakpoint
CREATE INDEX "post_work_orders_organization_stage_idx" ON "post_work_orders" USING btree ("organization_id","workflow_stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stage_work_order_templates_stage_position_idx" ON "workflow_stage_work_order_templates" USING btree ("workflow_stage_id","position");--> statement-breakpoint
CREATE INDEX "workflow_stage_work_order_templates_organization_idx" ON "workflow_stage_work_order_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE TRIGGER "workflow_stage_work_order_templates_tenant_links" BEFORE INSERT OR UPDATE ON "workflow_stage_work_order_templates" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('workflow_stage_id', 'workflow_stages');--> statement-breakpoint
CREATE TRIGGER "post_work_orders_tenant_links" BEFORE INSERT OR UPDATE ON "post_work_orders" FOR EACH ROW EXECUTE FUNCTION "public"."postpilot_enforce_tenant_links"('episode_id', 'episodes', 'workflow_stage_id', 'workflow_stages', 'booking_id', 'bookings', 'qc_issue_id', 'qc_issues', 'assignee_person_id', 'people', 'completed_by_person_id', 'people');
