CREATE TYPE "workflow_dependency_behaviour" AS ENUM ('blocks_start', 'blocks_completion', 'both');
CREATE TYPE "workflow_dependency_requirement" AS ENUM ('predecessor_complete', 'predecessor_fully_signed_off');

CREATE TABLE "workflow_stage_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "workflow_id" uuid NOT NULL REFERENCES "post_workflows"("id") ON DELETE CASCADE,
  "predecessor_stage_id" uuid NOT NULL REFERENCES "workflow_stages"("id") ON DELETE CASCADE,
  "dependent_stage_id" uuid NOT NULL REFERENCES "workflow_stages"("id") ON DELETE CASCADE,
  "behaviour" "workflow_dependency_behaviour" DEFAULT 'both' NOT NULL,
  "requirement" "workflow_dependency_requirement" DEFAULT 'predecessor_complete' NOT NULL,
  "note" text,
  "position" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_stage_dependencies_not_self" CHECK ("predecessor_stage_id" <> "dependent_stage_id")
);
CREATE UNIQUE INDEX "workflow_stage_dependencies_pair_idx" ON "workflow_stage_dependencies" ("predecessor_stage_id", "dependent_stage_id");
CREATE INDEX "workflow_stage_dependencies_org_workflow_idx" ON "workflow_stage_dependencies" ("organization_id", "workflow_id");
CREATE INDEX "workflow_stage_dependencies_dependent_idx" ON "workflow_stage_dependencies" ("dependent_stage_id");
