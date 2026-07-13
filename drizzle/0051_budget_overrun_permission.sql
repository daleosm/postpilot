UPDATE "organization_role_policies"
SET "permissions" = "permissions" || '["approve_budget_overruns"]'::jsonb
WHERE "permissions" ? 'approve_po_overruns'
  AND NOT ("permissions" ? 'approve_budget_overruns');
