ALTER TABLE "people" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."person_role";--> statement-breakpoint
INSERT INTO "organization_role_policies" ("organization_id", "role", "label", "permissions")
SELECT roles.organization_id,
  roles.role,
  initcap(replace(roles.role, '_', ' ')),
  CASE roles.role
    WHEN 'post_supervisor' THEN '["manage_shows","manage_bookings","manage_reviews","approve_reviews","manage_work_orders","update_assigned_work","manage_qc","waive_qc","manage_budget","request_catering","view_assigned"]'::jsonb
    WHEN 'producer' THEN '["manage_shows","manage_bookings","manage_reviews","approve_reviews","manage_work_orders","update_assigned_work","manage_qc","waive_qc","manage_budget","request_catering","view_assigned"]'::jsonb
    WHEN 'head_of_production' THEN '["manage_shows","manage_bookings","manage_work_orders","manage_budget","request_catering","view_assigned"]'::jsonb
    WHEN 'finance' THEN '["manage_budget","view_assigned"]'::jsonb
    WHEN 'runner' THEN '["request_catering","manage_catering","view_assigned"]'::jsonb
    WHEN 'qc' THEN '["update_assigned_work","manage_qc","verify_qc","request_catering","view_assigned"]'::jsonb
    WHEN 'director' THEN '["approve_reviews","view_assigned"]'::jsonb
    WHEN 'network' THEN '["approve_reviews","view_assigned"]'::jsonb
    WHEN 'network_client_executive' THEN '["approve_reviews","view_assigned"]'::jsonb
    WHEN 'network_client_representative' THEN '["approve_reviews","view_assigned"]'::jsonb
    WHEN 'client' THEN '["approve_reviews","view_assigned"]'::jsonb
    ELSE '["update_assigned_work","request_catering","view_assigned"]'::jsonb
  END
FROM (
  SELECT DISTINCT "organization_id", "role" FROM "people"
  UNION
  SELECT DISTINCT "organization_id", "approver_role" FROM "workflow_stage_approval_rules"
) AS roles
ON CONFLICT ("organization_id", "role") DO NOTHING;
