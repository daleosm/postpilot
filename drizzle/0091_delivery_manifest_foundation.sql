CREATE TYPE "delivery_item_status" AS ENUM ('not_started', 'in_progress', 'ready_for_qc', 'qc_failed', 'qc_passed', 'submitted', 'receipt_confirmed', 'rejected', 'waived');
CREATE TYPE "delivery_qc_result" AS ENUM ('not_required', 'not_started', 'passed', 'failed', 'waived');

CREATE TABLE "delivery_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "client_company_id" uuid REFERENCES "crm_companies"("id") ON DELETE SET NULL,
  "network" text,
  "show_id" uuid REFERENCES "shows"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "specification_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "delivery_profiles_org_name_idx" ON "delivery_profiles" ("organization_id", "name");
CREATE INDEX "delivery_profiles_org_show_active_idx" ON "delivery_profiles" ("organization_id", "show_id", "is_active");
CREATE INDEX "delivery_profiles_org_client_network_idx" ON "delivery_profiles" ("organization_id", "client_company_id", "network");

ALTER TABLE "shows" ADD COLUMN "delivery_profile_id" uuid REFERENCES "delivery_profiles"("id") ON DELETE SET NULL;
CREATE INDEX "shows_organization_delivery_profile_idx" ON "shows" ("organization_id", "delivery_profile_id");

CREATE TABLE "delivery_profile_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "delivery_profile_id" uuid NOT NULL REFERENCES "delivery_profiles"("id") ON DELETE CASCADE,
  "component_type" text NOT NULL,
  "label" text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "format_specification" text,
  "version" text,
  "territory" text,
  "language" text,
  "recipient_contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
  "qc_required" boolean DEFAULT false NOT NULL,
  "default_deadline_offset_days" integer,
  "position" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "delivery_profile_items_profile_position_idx" ON "delivery_profile_items" ("delivery_profile_id", "position");
CREATE INDEX "delivery_profile_items_org_profile_idx" ON "delivery_profile_items" ("organization_id", "delivery_profile_id");
CREATE INDEX "delivery_profile_items_org_recipient_idx" ON "delivery_profile_items" ("organization_id", "recipient_contact_id");

CREATE TABLE "episode_delivery_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "delivery_profile_id" uuid REFERENCES "delivery_profiles"("id") ON DELETE SET NULL,
  "profile_name" text NOT NULL,
  "specification_url" text,
  "applied_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "episode_delivery_manifests_episode_idx" ON "episode_delivery_manifests" ("episode_id");
CREATE INDEX "episode_delivery_manifests_org_episode_idx" ON "episode_delivery_manifests" ("organization_id", "episode_id");
CREATE INDEX "episode_delivery_manifests_org_profile_idx" ON "episode_delivery_manifests" ("organization_id", "delivery_profile_id");

CREATE TABLE "episode_delivery_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "episode_delivery_manifest_id" uuid NOT NULL REFERENCES "episode_delivery_manifests"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "delivery_profile_item_id" uuid REFERENCES "delivery_profile_items"("id") ON DELETE SET NULL,
  "component_type" text NOT NULL,
  "label" text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "format_specification" text,
  "version" text,
  "territory" text,
  "language" text,
  "recipient_contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
  "recipient_name" text,
  "recipient_email" text,
  "qc_required" boolean DEFAULT false NOT NULL,
  "status" "delivery_item_status" DEFAULT 'not_started' NOT NULL,
  "due_date" date,
  "external_url" text,
  "external_reference" text,
  "submission_method" text,
  "submitted_by_person_id" uuid REFERENCES "people"("id") ON DELETE SET NULL,
  "submitted_at" timestamp with time zone,
  "qc_result" "delivery_qc_result" DEFAULT 'not_required' NOT NULL,
  "receipt_confirmed_at" timestamp with time zone,
  "receipt_confirmed_by" text,
  "rejection_reason" text,
  "position" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "episode_delivery_items_manifest_position_idx" ON "episode_delivery_items" ("episode_delivery_manifest_id", "position");
CREATE INDEX "episode_delivery_items_org_episode_due_idx" ON "episode_delivery_items" ("organization_id", "episode_id", "due_date");
CREATE INDEX "episode_delivery_items_org_manifest_status_idx" ON "episode_delivery_items" ("organization_id", "episode_delivery_manifest_id", "status");
