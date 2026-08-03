"""Make budget estimates explainable and actuals allocation-backed.

Revision ID: 20260730_05
Revises: 20260727_04
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260730_05"
down_revision: str | Sequence[str] | None = "20260727_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("budget_lines", sa.Column("planned_quantity", sa.Numeric(12, 2), nullable=True))
    op.add_column("budget_lines", sa.Column("planned_unit", sa.Text(), nullable=True))
    op.add_column("budget_lines", sa.Column("rate_snapshot", sa.Numeric(14, 2), nullable=True))
    op.add_column("budget_lines", sa.Column("rate_source", sa.Text(), nullable=True))
    op.add_column("budget_lines", sa.Column("resource_reference", sa.Text(), nullable=True))
    op.add_column(
        "budget_lines",
        sa.Column("estimate_status", sa.Text(), nullable=False, server_default=sa.text("'legacy'")),
    )
    op.add_column("budget_lines", sa.Column("manual_override_reason", sa.Text(), nullable=True))
    op.create_check_constraint(
        "budget_lines_estimate_status_check",
        "budget_lines",
        "estimate_status IN ('legacy', 'draft', 'approved', 'revised')",
    )
    op.create_check_constraint(
        "budget_lines_planned_unit_check",
        "budget_lines",
        "planned_unit IS NULL OR planned_unit IN ('hour', 'day', 'episode', 'fixed', 'unit')",
    )

    op.create_table(
        "budget_actual_allocations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("budget_line_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("work_order_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("vendor_invoice_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("manual_adjustment_reason", sa.Text(), nullable=True),
        sa.Column("source_reference", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("allocation_date", sa.Date(), nullable=False),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("amount >= 0", name="budget_actual_allocations_amount_check"),
        sa.CheckConstraint(
            """
            (source_type IN ('booking', 'time_submission') AND booking_id IS NOT NULL
              AND work_order_id IS NULL AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NULL)
            OR (source_type = 'work_order' AND booking_id IS NULL
              AND work_order_id IS NOT NULL AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NULL)
            OR (source_type = 'vendor_invoice' AND booking_id IS NULL
              AND work_order_id IS NULL AND vendor_invoice_id IS NOT NULL AND manual_adjustment_reason IS NULL)
            OR (source_type = 'manual_adjustment' AND booking_id IS NULL
              AND work_order_id IS NULL AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NOT NULL)
            """,
            name="budget_actual_allocations_one_source_check",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["budget_line_id"], ["budget_lines.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["work_order_id"], ["post_work_orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["vendor_invoice_id"], ["vendor_invoices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "budget_actual_allocations_tenant_line_idx", "budget_actual_allocations", ["organization_id", "budget_line_id"]
    )
    op.create_index(
        "budget_actual_allocations_tenant_date_idx", "budget_actual_allocations", ["organization_id", "allocation_date"]
    )
    op.create_index(
        "budget_actual_allocations_booking_unique",
        "budget_actual_allocations",
        ["organization_id", "booking_id", "source_type"],
        unique=True,
        postgresql_where=sa.text("booking_id IS NOT NULL"),
    )
    op.create_index(
        "budget_actual_allocations_work_order_unique",
        "budget_actual_allocations",
        ["organization_id", "work_order_id"],
        unique=True,
        postgresql_where=sa.text("work_order_id IS NOT NULL"),
    )
    op.create_index(
        "budget_actual_allocations_invoice_unique",
        "budget_actual_allocations",
        ["organization_id", "vendor_invoice_id"],
        unique=True,
        postgresql_where=sa.text("vendor_invoice_id IS NOT NULL"),
    )
    op.create_index(
        "budget_actual_allocations_manual_reference_unique",
        "budget_actual_allocations",
        ["organization_id", "budget_line_id", "source_type", "source_reference"],
        unique=True,
        postgresql_where=sa.text("source_type = 'manual_adjustment' AND source_reference IS NOT NULL"),
    )
    op.execute(
        """
        CREATE TRIGGER budget_actual_allocations_tenant_links BEFORE INSERT OR UPDATE ON budget_actual_allocations
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_tenant_links(
          'budget_line_id', 'budget_lines', 'booking_id', 'bookings', 'work_order_id', 'post_work_orders',
          'vendor_invoice_id', 'vendor_invoices'
        )
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.postpilot_refresh_budget_line_actual()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE target_line uuid;
        BEGIN
          target_line := COALESCE(NEW.budget_line_id, OLD.budget_line_id);
          UPDATE budget_lines
          SET actual_amount = COALESCE((
            SELECT SUM(amount) FROM budget_actual_allocations
            WHERE budget_line_id = target_line
          ), 0), updated_at = now()
          WHERE id = target_line;
          RETURN COALESCE(NEW, OLD);
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER budget_actual_allocations_refresh_line
        AFTER INSERT OR UPDATE OR DELETE ON budget_actual_allocations
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_refresh_budget_line_actual()
        """
    )
    # Existing amounts remain visible, but are now represented by an audited
    # legacy allocation instead of being accepted as a browser-supplied total.
    op.execute(
        """
        INSERT INTO budget_actual_allocations (
          organization_id, budget_line_id, source_type, manual_adjustment_reason,
          source_reference, amount, currency, allocation_date, created_at, updated_at
        )
        SELECT organization_id, id, 'manual_adjustment', 'Migrated historical actual',
          'legacy-budget-line-' || id::text, actual_amount, currency, CURRENT_DATE, now(), now()
        FROM budget_lines WHERE actual_amount <> 0
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS budget_actual_allocations_refresh_line ON budget_actual_allocations")
    op.execute("DROP FUNCTION IF EXISTS public.postpilot_refresh_budget_line_actual()")
    op.execute("DROP TRIGGER IF EXISTS budget_actual_allocations_tenant_links ON budget_actual_allocations")
    op.drop_index("budget_actual_allocations_invoice_unique", table_name="budget_actual_allocations")
    op.drop_index("budget_actual_allocations_manual_reference_unique", table_name="budget_actual_allocations")
    op.drop_index("budget_actual_allocations_work_order_unique", table_name="budget_actual_allocations")
    op.drop_index("budget_actual_allocations_booking_unique", table_name="budget_actual_allocations")
    op.drop_index("budget_actual_allocations_tenant_date_idx", table_name="budget_actual_allocations")
    op.drop_index("budget_actual_allocations_tenant_line_idx", table_name="budget_actual_allocations")
    op.drop_table("budget_actual_allocations")
    op.drop_constraint("budget_lines_planned_unit_check", "budget_lines", type_="check")
    op.drop_constraint("budget_lines_estimate_status_check", "budget_lines", type_="check")
    for column in (
        "manual_override_reason",
        "estimate_status",
        "resource_reference",
        "rate_source",
        "rate_snapshot",
        "planned_unit",
        "planned_quantity",
    ):
        op.drop_column("budget_lines", column)
