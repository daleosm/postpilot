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


def test_budget_actuals_are_allocation_backed_with_tenant_and_source_guards() -> None:
    migration = (ROOT / "backend/alembic/versions/20260730_05_budget_actual_allocations.py").read_text()

    for phrase in (
        "budget_actual_allocations",
        "budget_actual_allocations_one_source_check",
        "budget_actual_allocations_tenant_links",
        "postpilot_refresh_budget_line_actual",
        "Migrated historical actual",
        "planned_quantity",
        "manual_override_reason",
    ):
        assert phrase in migration


def test_booking_budget_item_links_are_episode_and_tenant_safe() -> None:
    migration = (ROOT / "backend/alembic/versions/20260730_06_booking_budget_items.py").read_text()

    for phrase in (
        'op.add_column("bookings", sa.Column("budget_line_id"',
        "bookings_budget_line_id_fkey",
        "bookings_tenant_episode_budget_line_idx",
        "budget_actual_allocations_booking_unique",
        "postpilot_enforce_booking_budget_line",
        "budget_episode <> NEW.episode_id",
        "budget_external",
    ):
        assert phrase in migration


def test_vendor_work_and_supplier_invoices_link_to_external_budget_items() -> None:
    migration = (ROOT / "backend/alembic/versions/20260730_07_vendor_budget_links.py").read_text()

    for phrase in (
        'op.add_column("post_work_orders", sa.Column("budget_line_id"',
        'op.add_column("vendor_invoices", sa.Column("budget_line_id"',
        "post_work_orders_vendor_budget_line_scope",
        "vendor_invoices_budget_line_scope",
        "postpilot_enforce_vendor_budget_line",
        "budget_external",
    ):
        assert phrase in migration


def test_episode_estimate_revisions_are_immutable_tenant_scoped_snapshots() -> None:
    migration = (ROOT / "backend/alembic/versions/20260730_08_episode_estimate_revisions.py").read_text()

    for phrase in (
        '"episode_budget_estimates"',
        '"episode_budget_estimate_items"',
        "episode_budget_estimates_status_check",
        "episode_budget_estimates_org_episode_revision_key",
        "episode_budget_estimates_one_open_draft_idx",
        "episode_budget_estimates_one_current_approved_idx",
        "episode_budget_estimate_items_tenant_source_idx",
        "status = 'draft'",
        "status = 'approved'",
    ):
        assert phrase in migration


def test_budget_metadata_backfill_preserves_existing_amounts_as_transparent_legacy_estimates() -> None:
    migration = (ROOT / "backend/alembic/versions/20260730_09_backfill_budget_estimate_metadata.py").read_text()

    for phrase in (
        "planned_quantity = COALESCE(planned_quantity, 1)",
        "planned_unit = COALESCE(planned_unit, 'fixed')",
        "rate_snapshot = COALESCE(rate_snapshot, budgeted_amount)",
        "'legacy_import'",
        "'legacy_budget_line · Historical planned amount'",
        "recalculates monetary values nor upgrades legacy estimates",
    ):
        assert phrase in migration


def test_historic_commercial_treatments_are_flagged_without_repricing_or_rewriting_invoices() -> None:
    migration = (ROOT / "backend/alembic/versions/20260805_34_flag_historic_commercial_treatments.py").read_text()

    for phrase in (
        "commercial_review_required",
        "Historic booking has no confirmed commercial treatment snapshot.",
        "Historic work order has no confirmed commercial treatment snapshot.",
        "commercial_treatment_snapshot_at IS NULL",
        "never consults current rate cards or resource records",
        "Existing rate snapshots, actual time and invoices remain untouched.",
    ):
        assert phrase in migration


def test_historic_work_order_review_flag_defaults_to_not_required() -> None:
    migration = (ROOT / "backend/alembic/versions/20260805_35_work_order_commercial_review_default.py").read_text()

    assert 'op.alter_column("post_work_orders", "commercial_review_required", server_default=sa.false())' in migration
