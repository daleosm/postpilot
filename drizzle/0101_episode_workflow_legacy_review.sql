CREATE TYPE "workflow_migration_review_status" AS ENUM ('open', 'resolved', 'ignored');

CREATE TABLE "episode_workflow_migration_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "legacy_workflow_stage_id" uuid,
  "legacy_status" text,
  "status" "workflow_migration_review_status" DEFAULT 'open' NOT NULL,
  "resolution_note" text,
  "reviewed_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "episode_workflow_migration_reviews_episode_idx" ON "episode_workflow_migration_reviews" ("episode_id");
CREATE INDEX "episode_workflow_migration_reviews_organization_status_idx" ON "episode_workflow_migration_reviews" ("organization_id", "status");

-- Build a complete set of tracks without trusting a legacy status. Where the
-- former pointer belongs to the tenant's default workflow, only its preceding
-- linear stages are safely inferred as complete. Pending approval records put
-- the current stage into submitted; every later stage stays not_started.
WITH default_stages AS (
  SELECT e."id" AS episode_id, e."organization_id", e."workflow_stage_id" AS legacy_stage_id,
    s."id" AS stage_id, s."position" AS stage_position,
    current_stage."position" AS current_position,
    current_stage."id" AS valid_current_stage_id,
    EXISTS (
      SELECT 1 FROM "episode_workflow_approvals" a
      WHERE a."organization_id" = e."organization_id"
        AND a."episode_id" = e."id"
        AND a."workflow_stage_id" = current_stage."id"
        AND a."status" = 'pending'
    ) AS current_has_pending_approval
  FROM "episodes" e
  INNER JOIN "post_workflows" w ON w."organization_id" = e."organization_id" AND w."is_default" = true
  INNER JOIN "workflow_stages" s ON s."organization_id" = e."organization_id" AND s."workflow_id" = w."id"
  LEFT JOIN "workflow_stages" current_stage ON current_stage."id" = e."workflow_stage_id" AND current_stage."organization_id" = e."organization_id" AND current_stage."workflow_id" = w."id"
)
INSERT INTO "episode_workflow_tracks" ("organization_id", "episode_id", "workflow_stage_id", "status", "started_at", "completed_at")
SELECT
  "organization_id", episode_id, stage_id,
  CASE
    WHEN valid_current_stage_id IS NULL THEN 'not_started'::"workflow_track_status"
    WHEN stage_position < current_position THEN 'complete'::"workflow_track_status"
    WHEN stage_id = valid_current_stage_id AND current_has_pending_approval THEN 'submitted'::"workflow_track_status"
    WHEN stage_id = valid_current_stage_id THEN 'in_progress'::"workflow_track_status"
    ELSE 'not_started'::"workflow_track_status"
  END,
  CASE WHEN stage_id = valid_current_stage_id THEN now() ELSE NULL END,
  CASE WHEN valid_current_stage_id IS NOT NULL AND stage_position < current_position THEN now() ELSE NULL END
FROM default_stages
ON CONFLICT ("episode_id", "workflow_stage_id") DO NOTHING;

-- Existing in-progress tracks with a pending approval were already submitted
-- under the old model, even if their former pointer was not updated.
UPDATE "episode_workflow_tracks" t
SET "status" = 'submitted', "updated_at" = now()
WHERE t."status" = 'in_progress'
  AND EXISTS (
    SELECT 1 FROM "episode_workflow_approvals" a
    WHERE a."organization_id" = t."organization_id"
      AND a."episode_id" = t."episode_id"
      AND a."workflow_stage_id" = t."workflow_stage_id"
      AND a."status" = 'pending'
  );

-- Anything that cannot be inferred without guessing is explicitly queued for
-- a producer/post-supervisor to resolve. Legacy fields remain untouched.
INSERT INTO "episode_workflow_migration_reviews" ("organization_id", "episode_id", "reason", "legacy_workflow_stage_id", "legacy_status")
SELECT e."organization_id", e."id",
  CASE
    WHEN w."id" IS NULL THEN 'No default workflow exists for this tenant.'
    WHEN e."workflow_stage_id" IS NULL THEN 'Legacy workflow stage is empty; all tracks were left not started.'
    WHEN current_stage."id" IS NULL THEN 'Legacy workflow stage is not part of the tenant default workflow; all tracks were left not started.'
    WHEN e."status" = 'delivered' THEN 'Legacy episode status says delivered; verify the terminal workflow track rather than inferring completion.'
    ELSE 'Legacy workflow state needs review.'
  END,
  e."workflow_stage_id", e."status"::text
FROM "episodes" e
LEFT JOIN "post_workflows" w ON w."organization_id" = e."organization_id" AND w."is_default" = true
LEFT JOIN "workflow_stages" current_stage ON current_stage."id" = e."workflow_stage_id" AND current_stage."organization_id" = e."organization_id" AND current_stage."workflow_id" = w."id"
WHERE w."id" IS NULL
  OR e."workflow_stage_id" IS NULL
  OR current_stage."id" IS NULL
  OR e."status" = 'delivered'
ON CONFLICT ("episode_id") DO NOTHING;
