-- Installations that ran the earlier track migration may have inferred a
-- terminal track from legacy `episodes.status = delivered`. Do not trust that
-- broad status: queue it for a human workflow review instead.
INSERT INTO "episode_workflow_migration_reviews" ("organization_id", "episode_id", "reason", "legacy_workflow_stage_id", "legacy_status")
SELECT
  e."organization_id",
  e."id",
  'Legacy episode status says delivered; verify the terminal workflow track rather than inferring completion.',
  e."workflow_stage_id",
  e."status"::text
FROM "episodes" e
WHERE e."status" = 'delivered'
ON CONFLICT ("episode_id") DO NOTHING;
