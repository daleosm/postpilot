-- Approvals are available only through episode-team and active-work-order assignment.
UPDATE "organization_role_policies"
SET "permissions" = "permissions" - 'manage_reviews'
WHERE "permissions" ? 'manage_reviews';
