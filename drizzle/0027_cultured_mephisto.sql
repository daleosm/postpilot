CREATE TABLE "episode_team_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"responsibility" text NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_team_assignments" ADD CONSTRAINT "episode_team_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_team_assignments" ADD CONSTRAINT "episode_team_assignments_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_team_assignments" ADD CONSTRAINT "episode_team_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_team_assignment_unique_idx" ON "episode_team_assignments" USING btree ("episode_id","person_id","responsibility");--> statement-breakpoint
CREATE INDEX "episode_team_assignment_episode_idx" ON "episode_team_assignments" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "episode_team_assignment_org_person_idx" ON "episode_team_assignments" USING btree ("organization_id","person_id");