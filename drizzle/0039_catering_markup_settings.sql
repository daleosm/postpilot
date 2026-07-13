CREATE TABLE "catering_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "markup_percent" numeric(7, 2) DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "catering_settings_org_idx" ON "catering_settings" USING btree ("organization_id");
ALTER TABLE "catering_requests" ADD COLUMN "billed_amount" numeric(12, 2);
ALTER TABLE "catering_requests" ADD COLUMN "markup_percent" numeric(7, 2);
