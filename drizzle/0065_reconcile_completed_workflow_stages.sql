-- Earlier versions recorded a completed sign-off without advancing the episode.
-- Reconcile only those safe historical cases: every required current-stage gate
-- is approved and every required next-stage gate has exactly one selected signer.
CREATE TEMP TABLE "postpilot_completed_stage_reconciliation" AS
SELECT
  "episode"."id" AS "episode_id",
  "episode"."organization_id",
  "current_stage"."id" AS "current_stage_id",
  "next_stage"."id" AS "next_stage_id",
  "next_stage"."name" AS "next_stage_name"
FROM "episodes" AS "episode"
INNER JOIN "workflow_stages" AS "current_stage"
  ON "current_stage"."id" = "episode"."workflow_stage_id"
  AND "current_stage"."organization_id" = "episode"."organization_id"
INNER JOIN LATERAL (
  SELECT "candidate"."id", "candidate"."name"
  FROM "workflow_stages" AS "candidate"
  WHERE "candidate"."workflow_id" = "current_stage"."workflow_id"
    AND "candidate"."organization_id" = "episode"."organization_id"
    AND "candidate"."position" > "current_stage"."position"
  ORDER BY "candidate"."position"
  LIMIT 1
) AS "next_stage" ON true
WHERE EXISTS (
  SELECT 1
  FROM "workflow_stage_approval_rules" AS "rule"
  INNER JOIN "episode_workflow_approvals" AS "approval"
    ON "approval"."approval_rule_id" = "rule"."id"
    AND "approval"."episode_id" = "episode"."id"
    AND "approval"."organization_id" = "episode"."organization_id"
    AND "approval"."status" = 'approved'
  WHERE "rule"."workflow_stage_id" = "current_stage"."id"
    AND "rule"."organization_id" = "episode"."organization_id"
    AND "rule"."is_required" = true
)
AND NOT EXISTS (
  SELECT 1
  FROM "workflow_stage_approval_rules" AS "rule"
  WHERE "rule"."workflow_stage_id" = "current_stage"."id"
    AND "rule"."organization_id" = "episode"."organization_id"
    AND "rule"."is_required" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "episode_workflow_approvals" AS "approval"
      WHERE "approval"."episode_id" = "episode"."id"
        AND "approval"."organization_id" = "episode"."organization_id"
        AND "approval"."approval_rule_id" = "rule"."id"
        AND "approval"."status" = 'approved'
    )
)
AND NOT EXISTS (
  SELECT 1
  FROM "workflow_stage_approval_rules" AS "next_rule"
  WHERE "next_rule"."workflow_stage_id" = "next_stage"."id"
    AND "next_rule"."organization_id" = "episode"."organization_id"
    AND "next_rule"."is_required" = true
    AND 1 <> (
      SELECT count(*)
      FROM "episode_team_assignments" AS "assignment"
      INNER JOIN "people" AS "person"
        ON "person"."id" = "assignment"."person_id"
        AND "person"."organization_id" = "assignment"."organization_id"
      WHERE "assignment"."organization_id" = "episode"."organization_id"
        AND "assignment"."episode_id" = "episode"."id"
        AND "assignment"."is_lead" = true
        AND "person"."role" = "next_rule"."approver_role"
    )
);

INSERT INTO "episode_workflow_approvals" (
  "organization_id", "episode_id", "workflow_stage_id", "approval_rule_id", "approver_role", "required_person_id", "status"
)
SELECT
  "reconciliation"."organization_id",
  "reconciliation"."episode_id",
  "reconciliation"."next_stage_id",
  "rule"."id",
  "rule"."approver_role",
  "signer"."person_id",
  'pending'
FROM "postpilot_completed_stage_reconciliation" AS "reconciliation"
INNER JOIN "workflow_stage_approval_rules" AS "rule"
  ON "rule"."workflow_stage_id" = "reconciliation"."next_stage_id"
  AND "rule"."organization_id" = "reconciliation"."organization_id"
  AND "rule"."is_required" = true
INNER JOIN LATERAL (
  SELECT "person"."id" AS "person_id"
  FROM "episode_team_assignments" AS "assignment"
  INNER JOIN "people" AS "person"
    ON "person"."id" = "assignment"."person_id"
    AND "person"."organization_id" = "assignment"."organization_id"
  WHERE "assignment"."organization_id" = "reconciliation"."organization_id"
    AND "assignment"."episode_id" = "reconciliation"."episode_id"
    AND "assignment"."is_lead" = true
    AND "person"."role" = "rule"."approver_role"
  LIMIT 1
) AS "signer" ON true
ON CONFLICT ("episode_id", "approval_rule_id") DO NOTHING;

UPDATE "episodes" AS "episode"
SET "workflow_stage_id" = "reconciliation"."next_stage_id", "updated_at" = NOW()
FROM "postpilot_completed_stage_reconciliation" AS "reconciliation"
WHERE "episode"."id" = "reconciliation"."episode_id"
  AND "episode"."organization_id" = "reconciliation"."organization_id";

INSERT INTO "activity_log" ("organization_id", "action", "entity_type", "entity_id", "metadata")
SELECT
  "organization_id",
  'workflow.completed_stage_reconciled',
  'episode',
  "episode_id"::text,
  jsonb_build_object('fromStageId', "current_stage_id", 'toStageId', "next_stage_id", 'toStageName', "next_stage_name")
FROM "postpilot_completed_stage_reconciliation";

DROP TABLE "postpilot_completed_stage_reconciliation";
