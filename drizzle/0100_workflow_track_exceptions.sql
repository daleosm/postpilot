CREATE TYPE "workflow_exception_type" AS ENUM ('early_start', 'dependency');

ALTER TABLE "workflow_stage_dependencies"
  ADD COLUMN "allow_exception" boolean DEFAULT false NOT NULL;

CREATE TABLE "episode_workflow_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "workflow_stage_id" uuid NOT NULL REFERENCES "workflow_stages"("id") ON DELETE CASCADE,
  "workflow_stage_dependency_id" uuid REFERENCES "workflow_stage_dependencies"("id") ON DELETE CASCADE,
  "type" "workflow_exception_type" NOT NULL,
  "reason" text NOT NULL,
  "authorized_by_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "episode_workflow_exceptions_episode_early_start_idx"
  ON "episode_workflow_exceptions" ("episode_id", "workflow_stage_id")
  WHERE "type" = 'early_start';
CREATE UNIQUE INDEX "episode_workflow_exceptions_episode_dependency_idx"
  ON "episode_workflow_exceptions" ("episode_id", "workflow_stage_dependency_id");
CREATE INDEX "episode_workflow_exceptions_organization_id_idx"
  ON "episode_workflow_exceptions" ("organization_id");
CREATE INDEX "episode_workflow_exceptions_episode_stage_idx"
  ON "episode_workflow_exceptions" ("episode_id", "workflow_stage_id");
