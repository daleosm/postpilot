-- Preserve existing tenant behaviour while moving workflow authority away from
-- the broad shows capability. Policies remain tenant-owned JSONB data.
update organization_role_policies as policy
set permissions = (
  select jsonb_agg(distinct value order by value)
  from jsonb_array_elements_text(
    policy.permissions
    || case when policy.permissions ? 'manage_shows'
      then '["manage_workflow_configuration","manage_workflow_tracks","submit_workflow_tracks","sign_off_workflow_tracks"]'::jsonb
      else '[]'::jsonb end
    || case when policy.permissions ? 'update_assigned_work'
      then '["update_assigned_workflow_work","submit_workflow_tracks","sign_off_workflow_tracks"]'::jsonb
      else '[]'::jsonb end
  ) as permission(value)
);
