-- Workflows now progress solely by the configured stage position. Dependency
-- edges and dependency-specific exceptions are intentionally removed.
DELETE FROM "episode_workflow_exceptions" WHERE "type"::text = 'dependency';
ALTER TABLE "episode_workflow_exceptions" DROP COLUMN IF EXISTS "workflow_stage_dependency_id";
DROP TABLE IF EXISTS "workflow_stage_dependencies";
DROP TYPE IF EXISTS "workflow_dependency_behaviour";
DROP TYPE IF EXISTS "workflow_dependency_requirement";
DELETE FROM "episode_workflow_exceptions" older
USING "episode_workflow_exceptions" newer
WHERE older."type"::text = 'early_start'
  AND newer."type"::text = 'early_start'
  AND older."episode_id" = newer."episode_id"
  AND older."workflow_stage_id" = newer."workflow_stage_id"
  AND older."created_at" < newer."created_at";
CREATE UNIQUE INDEX IF NOT EXISTS "episode_workflow_exceptions_episode_stage_type_idx" ON "episode_workflow_exceptions" ("episode_id", "workflow_stage_id", "type");
