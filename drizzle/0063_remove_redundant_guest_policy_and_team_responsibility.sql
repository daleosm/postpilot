-- Guest is supplied by the fixed application policy and must not be persisted
-- as an editable tenant role-policy record.
DELETE FROM "organization_role_policies"
WHERE "role" = 'guest';

-- Remove only the legacy external-role policies that are genuinely unused.
-- Tenant-defined roles stay intact whenever a person or workflow rule uses them.
DELETE FROM "organization_role_policies" AS "policy"
WHERE "policy"."role" IN ('client', 'director')
  AND NOT EXISTS (
    SELECT 1 FROM "people" AS "person"
    WHERE "person"."organization_id" = "policy"."organization_id"
      AND "person"."role" = "policy"."role"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "workflow_stage_approval_rules" AS "rule"
    WHERE "rule"."organization_id" = "policy"."organization_id"
      AND "rule"."approver_role" = "policy"."role"
  );

-- Episode-team responsibility duplicated people.role and was no longer exposed
-- or editable. One person can now be assigned to an episode only once.
DROP INDEX IF EXISTS "episode_team_assignment_unique_idx";
ALTER TABLE "episode_team_assignments" DROP COLUMN IF EXISTS "responsibility";
CREATE UNIQUE INDEX "episode_team_assignment_episode_person_idx"
  ON "episode_team_assignments" USING btree ("episode_id", "person_id");
