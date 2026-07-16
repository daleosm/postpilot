UPDATE "organization_role_policies"
SET "permissions" = "permissions" || '["manage_shows"]'::jsonb
WHERE "role" = 'online_editor'
  AND NOT ("permissions" ? 'manage_shows');
