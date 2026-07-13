UPDATE "organization_role_policies"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM (
    SELECT jsonb_array_elements_text("permissions") AS permission
    UNION ALL SELECT 'manage_qc'
    UNION ALL SELECT 'verify_qc'
  ) AS expanded
)
WHERE "role" = 'qc';
