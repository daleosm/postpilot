-- Workflow sign-off is routed by the stage's configured role and the selected
-- episode-team signer. The legacy role permission is no longer authoritative.
UPDATE "organization_role_policies"
SET "permissions" = "permissions" - 'approve_reviews'
WHERE "permissions" ? 'approve_reviews';
