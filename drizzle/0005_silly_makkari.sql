CREATE TABLE "episode_workflow_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"approval_rule_id" uuid NOT NULL,
	"approver_role" text NOT NULL,
	"approver_person_id" uuid,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stage_approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"approver_role" text NOT NULL,
	"label" text NOT NULL,
	"approval_order" integer DEFAULT 1 NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD CONSTRAINT "episode_workflow_approvals_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD CONSTRAINT "episode_workflow_approvals_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD CONSTRAINT "episode_workflow_approvals_approval_rule_id_workflow_stage_approval_rules_id_fk" FOREIGN KEY ("approval_rule_id") REFERENCES "public"."workflow_stage_approval_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_workflow_approvals" ADD CONSTRAINT "episode_workflow_approvals_approver_person_id_people_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_approval_rules" ADD CONSTRAINT "workflow_stage_approval_rules_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_workflow_approvals_episode_rule_idx" ON "episode_workflow_approvals" USING btree ("episode_id","approval_rule_id");--> statement-breakpoint
CREATE INDEX "episode_workflow_approvals_episode_stage_idx" ON "episode_workflow_approvals" USING btree ("episode_id","workflow_stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stage_approval_rules_stage_role_order_idx" ON "workflow_stage_approval_rules" USING btree ("workflow_stage_id","approver_role","approval_order");--> statement-breakpoint
CREATE INDEX "workflow_stage_approval_rules_stage_idx" ON "workflow_stage_approval_rules" USING btree ("workflow_stage_id");