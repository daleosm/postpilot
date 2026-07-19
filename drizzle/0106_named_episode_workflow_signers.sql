-- Sign-off slots are configured on workflow stages and assigned to a named
-- episode-team person. Roles remain policy labels only; they are not used by
-- the workflow engine to choose or authorise a signer.
ALTER TABLE "workflow_stage_approval_rules" ALTER COLUMN "approver_role" DROP NOT NULL;
ALTER TABLE "episode_workflow_approvals" ALTER COLUMN "approver_role" DROP NOT NULL;

CREATE TABLE "episode_workflow_signers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "workflow_stage_approval_rule_id" uuid NOT NULL REFERENCES "workflow_stage_approval_rules"("id") ON DELETE CASCADE,
  "person_id" uuid NOT NULL REFERENCES "people"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "episode_workflow_signers_episode_rule_idx" ON "episode_workflow_signers" ("episode_id", "workflow_stage_approval_rule_id");
CREATE INDEX "episode_workflow_signers_organization_episode_idx" ON "episode_workflow_signers" ("organization_id", "episode_id");
CREATE INDEX "episode_workflow_signers_organization_person_idx" ON "episode_workflow_signers" ("organization_id", "person_id");

-- Preserve the former role-based selection as a starting point. Where old
-- data was ambiguous or had no signer, no assignment is guessed.
INSERT INTO "episode_workflow_signers" ("organization_id", "episode_id", "workflow_stage_approval_rule_id", "person_id")
SELECT DISTINCT ON (eta."episode_id", rule."id")
  eta."organization_id", eta."episode_id", rule."id", eta."person_id"
FROM "episode_team_assignments" eta
INNER JOIN "people" person
  ON person."id" = eta."person_id" AND person."organization_id" = eta."organization_id"
INNER JOIN "workflow_stage_approval_rules" rule
  ON rule."organization_id" = eta."organization_id" AND rule."approver_role" = person."role"
WHERE eta."is_lead" = true
ORDER BY eta."episode_id", rule."id", eta."created_at";
