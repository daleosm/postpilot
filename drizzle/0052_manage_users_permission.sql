UPDATE "organization_role_policies"
SET "permissions" = "permissions" || '["manage_users"]'::jsonb
WHERE "permissions" ? 'manage_shows'
  AND NOT ("permissions" ? 'manage_users');
