CREATE TYPE "public"."asset_kind" AS ENUM('picture', 'audio', 'vfx', 'graphics', 'document', 'other');--> statement-breakpoint
CREATE TYPE "public"."billable_status" AS ENUM('draft', 'approved', 'invoiced', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('tentative', 'confirmed', 'hold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('not_started', 'in_progress', 'qc', 'ready', 'delivered', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('development', 'assembly', 'editor_cut', 'review', 'locked', 'online', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."note_status" AS ENUM('open', 'addressed', 'wont_fix');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('producer', 'post_supervisor', 'editor', 'assistant_editor', 'colorist', 'sound_mixer', 'vfx_coordinator', 'qc', 'network', 'client', 'freelancer');--> statement-breakpoint
CREATE TYPE "public"."qc_status" AS ENUM('not_started', 'in_progress', 'passed', 'needs_attention', 'waived');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'in_review', 'approved', 'changes_requested', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('not_started', 'in_progress', 'blocked', 'complete');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"show_id" uuid,
	"episode_id" uuid,
	"vendor" text NOT NULL,
	"reference" text,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "billable_status" DEFAULT 'draft' NOT NULL,
	"invoice_date" date,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"room_id" uuid,
	"episode_id" uuid,
	"person_id" uuid,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'tentative' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"show_id" uuid,
	"season_id" uuid,
	"episode_id" uuid,
	"code" text,
	"category" text NOT NULL,
	"description" text,
	"budgeted_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"actual_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"name" text NOT NULL,
	"destination" text NOT NULL,
	"status" "deliverable_status" DEFAULT 'not_started' NOT NULL,
	"due_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"label" text NOT NULL,
	"specification" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"workflow_stage_id" uuid,
	"assigned_producer_id" uuid,
	"editor_id" uuid,
	"colorist_id" uuid,
	"sound_mixer_id" uuid,
	"number" integer NOT NULL,
	"production_code" text,
	"title" text NOT NULL,
	"synopsis" text,
	"status" "episode_status" DEFAULT 'development' NOT NULL,
	"qc_status" "qc_status" DEFAULT 'not_started' NOT NULL,
	"air_date" date,
	"locked_cut_date" date,
	"delivery_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid,
	"uploaded_by_user_id" text,
	"name" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"checksum" text,
	"duration_seconds" numeric(12, 3),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text,
	"role" "person_role" NOT NULL,
	"company" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"show_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"created_by_user_id" text,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_cut_id" uuid NOT NULL,
	"author_user_id" text,
	"author_name" text,
	"body" text NOT NULL,
	"timecode_seconds" numeric(12, 3),
	"status" "note_status" DEFAULT 'open' NOT NULL,
	"addressed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"location" text,
	"capacity" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"code" text NOT NULL,
	"network" text,
	"production_company" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"show_id" uuid,
	"episode_id" uuid,
	"workflow_stage_id" uuid,
	"assignee_id" uuid,
	"created_by_user_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"color" text DEFAULT '#687a78' NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billables" ADD CONSTRAINT "billables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billables" ADD CONSTRAINT "billables_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billables" ADD CONSTRAINT "billables_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_requirements" ADD CONSTRAINT "delivery_requirements_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_assigned_producer_id_people_id_fk" FOREIGN KEY ("assigned_producer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_editor_id_people_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_colorist_id_people_id_fk" FOREIGN KEY ("colorist_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_sound_mixer_id_people_id_fk" FOREIGN KEY ("sound_mixer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_workflows" ADD CONSTRAINT "post_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_workflows" ADD CONSTRAINT "post_workflows_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cuts" ADD CONSTRAINT "review_cuts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cuts" ADD CONSTRAINT "review_cuts_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cuts" ADD CONSTRAINT "review_cuts_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cuts" ADD CONSTRAINT "review_cuts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_review_cut_id_review_cuts_id_fk" FOREIGN KEY ("review_cut_id") REFERENCES "public"."review_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_id_post_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."post_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_organization_created_idx" ON "activity_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "billables_organization_status_idx" ON "billables" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "bookings_room_time_idx" ON "bookings" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_episode_time_idx" ON "bookings" USING btree ("episode_id","starts_at");--> statement-breakpoint
CREATE INDEX "budget_lines_organization_id_idx" ON "budget_lines" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deliverables_episode_status_idx" ON "deliverables" USING btree ("episode_id","status");--> statement-breakpoint
CREATE INDEX "delivery_requirements_deliverable_id_idx" ON "delivery_requirements" USING btree ("deliverable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_season_number_idx" ON "episodes" USING btree ("season_id","number");--> statement-breakpoint
CREATE INDEX "episodes_workflow_stage_id_idx" ON "episodes" USING btree ("workflow_stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_idx" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_episode_id_idx" ON "media_assets" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "people_organization_id_idx" ON "people" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_organization_user_idx" ON "people" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "post_workflows_organization_id_idx" ON "post_workflows" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_cuts_episode_version_idx" ON "review_cuts" USING btree ("episode_id","version");--> statement-breakpoint
CREATE INDEX "review_cuts_organization_status_idx" ON "review_cuts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "review_notes_cut_status_idx" ON "review_notes" USING btree ("review_cut_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_organization_name_idx" ON "rooms" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_show_number_idx" ON "seasons" USING btree ("show_id","number");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shows_organization_code_idx" ON "shows" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "shows_organization_id_idx" ON "shows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tasks_organization_status_idx" ON "tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "tasks_episode_id_idx" ON "tasks" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_workflow_key_idx" ON "workflow_stages" USING btree ("workflow_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_workflow_position_idx" ON "workflow_stages" USING btree ("workflow_id","position");