CREATE TABLE "service_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_rates" ADD CONSTRAINT "service_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_rates_organization_name_idx" ON "service_rates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "service_rates_organization_id_idx" ON "service_rates" USING btree ("organization_id");