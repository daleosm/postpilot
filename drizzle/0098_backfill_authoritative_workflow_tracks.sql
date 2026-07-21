-- Every existing episode receives a track for each stage in its tenant's default
-- workflow. The former pointer is consulted once only when it belongs to that
-- workflow. A legacy broad status is deliberately never used to infer progress.
INSERT INTO "episode_workflow_tracks" (
  "organization_id", "episode_id", "workflow_stage_id", "status", "started_at", "completed_at"
)
SELECT
  e."organization_id",
  e."id",
  s."id",
  CASE
    WHEN current_stage."id" IS NULL THEN 'not_started'::"workflow_track_status"
    -- `complete` is introduced by 0097. PostgreSQL does not permit a new
    -- enum value to be used while this clean-database migration batch is
    -- still open, so use the pre-existing equivalent state here. Later
    -- workflow logic already treats `approved` as a completed track.
    WHEN s."position" < current_stage."position" THEN 'approved'::"workflow_track_status"
    WHEN e."workflow_stage_id" = s."id" AND EXISTS (
      SELECT 1 FROM "episode_workflow_approvals" a
      WHERE a."organization_id" = e."organization_id"
        AND a."episode_id" = e."id"
        AND a."workflow_stage_id" = s."id"
        AND a."status" = 'pending'
    ) THEN 'submitted'::"workflow_track_status"
    WHEN e."workflow_stage_id" = s."id" THEN 'in_progress'::"workflow_track_status"
    ELSE 'not_started'::"workflow_track_status"
  END,
  CASE WHEN current_stage."id" IS NOT NULL AND e."workflow_stage_id" = s."id" THEN e."updated_at" ELSE NULL END,
  CASE WHEN current_stage."id" IS NOT NULL AND s."position" < current_stage."position" THEN e."updated_at" ELSE NULL END
FROM "episodes" e
INNER JOIN "post_workflows" w
  ON w."organization_id" = e."organization_id" AND w."is_default" = true
INNER JOIN "workflow_stages" s
  ON s."organization_id" = e."organization_id" AND s."workflow_id" = w."id"
LEFT JOIN "workflow_stages" current_stage
  ON current_stage."id" = e."workflow_stage_id"
  AND current_stage."organization_id" = e."organization_id"
  AND current_stage."workflow_id" = w."id"
ON CONFLICT ("episode_id", "workflow_stage_id") DO NOTHING;
