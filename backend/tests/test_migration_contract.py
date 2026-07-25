from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_python_alembic_bootstrap_owns_historical_schema_application() -> None:
    migration = (ROOT / "backend/alembic/versions/20260724_00_existing_postpilot_schema.py").read_text()

    assert 'glob("*.sql")' in migration
    assert "to_regclass('public.organizations')" in migration
    assert "connection.exec_driver_sql(sql)" in migration


def test_workflow_backfill_inferrs_only_safe_legacy_progress() -> None:
    migration = (ROOT / "drizzle/0101_episode_workflow_legacy_review.sql").read_text()
    assert "WHEN valid_current_stage_id IS NULL THEN 'not_started'" in migration
    assert "WHEN stage_position < current_position THEN 'approved'" in migration
    assert "WHEN stage_id = valid_current_stage_id AND current_has_pending_approval THEN 'submitted'" in migration
    assert "WHEN e.\"status\" = 'delivered' THEN 'complete'" not in migration


def test_workflow_backfill_has_tenant_scoped_ambiguous_record_review() -> None:
    migration = (ROOT / "drizzle/0101_episode_workflow_legacy_review.sql").read_text()
    for phrase in (
        'CREATE TABLE "episode_workflow_migration_reviews"',
        "No default workflow exists for this tenant",
        "Legacy workflow stage is empty; all tracks were left not started",
        "Legacy workflow stage is not part of the tenant default workflow",
        "Legacy episode status says delivered; verify the terminal workflow track",
        'ON CONFLICT ("episode_id") DO NOTHING',
    ):
        assert phrase in migration


def test_guest_to_client_migration_is_explicit() -> None:
    migration = (ROOT / "drizzle/0108_rename_guest_to_client.sql").read_text()
    assert "ALTER TYPE \"organization_role\" RENAME VALUE 'guest' TO 'client'" in migration


def test_client_work_order_commitments_have_a_dedicated_tenant_safe_ledger_source() -> None:
    enum_migration = (ROOT / "drizzle/0111_client_po_work_order_allocation_type.sql").read_text()
    ledger_migration = (ROOT / "drizzle/0112_client_po_work_order_commitments.sql").read_text()

    assert "ADD VALUE IF NOT EXISTS 'work_order'" in enum_migration
    assert '"work_order_id" uuid REFERENCES "post_work_orders"("id")' in ledger_migration
    assert '"client_po_allocations_org_work_order_idx"' in ledger_migration
    assert "\"allocation_type\" = 'work_order'" in ledger_migration
