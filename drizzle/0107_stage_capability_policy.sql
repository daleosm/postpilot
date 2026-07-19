-- Workflow authority is expressed as tenant capabilities, never membership
-- roles or named post-production job roles. These names match the one-current-
--stage workflow model and replace the retired track/exception terminology.
UPDATE "organization_role_policies"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT CASE permission.value
    WHEN 'manage_workflow_tracks' THEN 'manage_workflow_stages'
    WHEN 'submit_workflow_tracks' THEN 'submit_workflow_stages'
    WHEN 'sign_off_workflow_tracks' THEN 'sign_off_workflow_stages'
    WHEN 'authorize_workflow_exceptions' THEN 'authorize_early_starts'
    ELSE permission.value
  END ORDER BY CASE permission.value
    WHEN 'manage_workflow_tracks' THEN 'manage_workflow_stages'
    WHEN 'submit_workflow_tracks' THEN 'submit_workflow_stages'
    WHEN 'sign_off_workflow_tracks' THEN 'sign_off_workflow_stages'
    WHEN 'authorize_workflow_exceptions' THEN 'authorize_early_starts'
    ELSE permission.value
  END)
  FROM jsonb_array_elements_text("organization_role_policies"."permissions") AS permission(value)
),
"updated_at" = now();
