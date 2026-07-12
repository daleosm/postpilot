CREATE TABLE "organization_role_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	"label" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_role_policies" ADD CONSTRAINT "organization_role_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_role_policies_org_role_idx" ON "organization_role_policies" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "organization_role_policies_organization_id_idx" ON "organization_role_policies" USING btree ("organization_id");