-- Upgrade only the untouched legacy default rule. Tenant workflows that have
-- been customised with a different role, label, order, or additional rules
-- are deliberately left unchanged.
UPDATE "workflow_stage_approval_rules" AS "rules"
SET
  "approver_role" = 'editor',
  "label" = 'editor sign-off',
  "updated_at" = NOW()
FROM "workflow_stages" AS "stages"
WHERE "rules"."workflow_stage_id" = "stages"."id"
  AND "stages"."key" = 'editor_cut'
  AND "rules"."approver_role" = 'post_supervisor'
  AND "rules"."label" = 'post supervisor sign-off'
  AND "rules"."approval_order" = 1;
