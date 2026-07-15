-- Guest is a fixed external-access role. It is intentionally not a
-- configurable operational role, but it can be selected by workflow gates.
INSERT INTO "organization_role_policies" ("organization_id", "role", "label", "permissions")
SELECT "id", 'guest', 'Guest', '["approve_reviews","view_assigned"]'::jsonb
FROM "organizations"
ON CONFLICT ("organization_id", "role") DO UPDATE
SET "label" = EXCLUDED."label", "permissions" = EXCLUDED."permissions", "updated_at" = NOW();

-- A guest membership must always use the fixed Guest person role.
UPDATE "people" AS "person"
SET "role" = 'guest', "updated_at" = NOW()
FROM "organization_members" AS "membership"
WHERE "membership"."organization_id" = "person"."organization_id"
  AND "membership"."user_id" = "person"."user_id"
  AND "membership"."role" = 'guest'
  AND "person"."role" <> 'guest';

-- The seeded external review gates now route to a Guest signer. The stage
-- names remain descriptive of the review context, rather than a job title.
UPDATE "workflow_stage_approval_rules" AS "rules"
SET "approver_role" = 'guest', "label" = 'Guest sign-off', "updated_at" = NOW()
FROM "workflow_stages" AS "stage"
WHERE "stage"."id" = "rules"."workflow_stage_id"
  AND "stage"."key" IN ('director_review', 'studio_network_client_review', 'client_network_acceptance')
  AND "rules"."approver_role" IN ('director', 'client', 'network_client_executive', 'network_client_representative');
