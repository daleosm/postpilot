-- Episodes now have one authoritative current stage and a compact lifecycle.
-- The old broad episode status and all historic track rows are deliberately
-- retained so existing activity and approvals are never lost.
CREATE TYPE "episode_workflow_status" AS ENUM ('not_started', 'in_progress', 'awaiting_sign_off', 'blocked', 'complete');
ALTER TABLE "episodes" ADD COLUMN "workflow_status" "episode_workflow_status" DEFAULT 'not_started' NOT NULL;

WITH resolved AS (
  SELECT
    e."id" AS episode_id,
    COALESCE(current_track."workflow_stage_id", complete_track."workflow_stage_id", e."workflow_stage_id", first_stage."id") AS workflow_stage_id,
    CASE
      WHEN current_track."status" = 'blocked' THEN 'blocked'::"episode_workflow_status"
      WHEN current_track."status" = 'submitted' THEN 'awaiting_sign_off'::"episode_workflow_status"
      WHEN current_track."status" IN ('in_progress', 'changes_requested') THEN 'in_progress'::"episode_workflow_status"
      WHEN complete_track."workflow_stage_id" IS NOT NULL THEN 'complete'::"episode_workflow_status"
      ELSE 'not_started'::"episode_workflow_status"
    END AS workflow_status
  FROM "episodes" e
  LEFT JOIN LATERAL (
    SELECT t."workflow_stage_id", t."status"
    FROM "episode_workflow_tracks" t
    INNER JOIN "workflow_stages" s ON s."id" = t."workflow_stage_id" AND s."organization_id" = e."organization_id"
    WHERE t."organization_id" = e."organization_id"
      AND t."episode_id" = e."id"
      AND t."status" NOT IN ('complete', 'approved', 'not_started')
    ORDER BY CASE t."status" WHEN 'blocked' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, s."position"
    LIMIT 1
  ) current_track ON true
  LEFT JOIN LATERAL (
    SELECT t."workflow_stage_id"
    FROM "episode_workflow_tracks" t
    INNER JOIN "workflow_stages" s ON s."id" = t."workflow_stage_id" AND s."organization_id" = e."organization_id"
    WHERE t."organization_id" = e."organization_id"
      AND t."episode_id" = e."id"
      AND t."status" IN ('complete', 'approved')
    ORDER BY s."position" DESC
    LIMIT 1
  ) complete_track ON true
  LEFT JOIN LATERAL (
    SELECT s."id"
    FROM "post_workflows" w
    INNER JOIN "workflow_stages" s ON s."workflow_id" = w."id" AND s."organization_id" = e."organization_id"
    WHERE w."organization_id" = e."organization_id" AND w."is_default" = true
    ORDER BY s."position"
    LIMIT 1
  ) first_stage ON true
)
UPDATE "episodes" e
SET "workflow_stage_id" = resolved."workflow_stage_id",
    "workflow_status" = resolved."workflow_status",
    "updated_at" = now()
FROM resolved
WHERE e."id" = resolved.episode_id;

CREATE INDEX "episodes_organization_workflow_state_idx"
  ON "episodes" ("organization_id", "workflow_stage_id", "workflow_status");
