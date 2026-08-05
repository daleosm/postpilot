"""Allocate booking actuals from immutable commercial components.

Revision ID: 20260805_33
Revises: 20260805_32
Create Date: 2026-08-05

Legacy booking-level allocations remain valid. New room and person actuals are
separate, idempotent component sources so an estimate can show a precise
operational trail without making an estimate a prerequisite for scheduling.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260805_33"
down_revision: str | Sequence[str] | None = "20260805_32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "budget_actual_allocations",
        sa.Column("booking_charge_component_id", postgresql.UUID(as_uuid=False), nullable=True),
    )
    op.create_foreign_key(
        "budget_actual_allocations_booking_component_id_fkey",
        "budget_actual_allocations",
        "booking_charge_components",
        ["booking_charge_component_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_constraint(
        "budget_actual_allocations_one_source_check",
        "budget_actual_allocations",
        type_="check",
    )
    op.create_check_constraint(
        "budget_actual_allocations_one_source_check",
        "budget_actual_allocations",
        """
        (source_type IN ('booking', 'time_submission') AND booking_id IS NOT NULL
          AND booking_charge_component_id IS NULL AND work_order_id IS NULL
          AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NULL)
        OR (source_type = 'booking_component' AND booking_id IS NOT NULL
          AND booking_charge_component_id IS NOT NULL AND work_order_id IS NULL
          AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NULL)
        OR (source_type = 'work_order' AND booking_id IS NULL
          AND booking_charge_component_id IS NULL AND work_order_id IS NOT NULL
          AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NULL)
        OR (source_type = 'vendor_invoice' AND booking_id IS NULL
          AND booking_charge_component_id IS NULL AND work_order_id IS NULL
          AND vendor_invoice_id IS NOT NULL AND manual_adjustment_reason IS NULL)
        OR (source_type = 'manual_adjustment' AND booking_id IS NULL
          AND booking_charge_component_id IS NULL AND work_order_id IS NULL
          AND vendor_invoice_id IS NULL AND manual_adjustment_reason IS NOT NULL)
        """,
    )
    op.drop_index("budget_actual_allocations_booking_unique", table_name="budget_actual_allocations")
    op.create_index(
        "budget_actual_allocations_booking_unique",
        "budget_actual_allocations",
        ["organization_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("booking_id IS NOT NULL AND source_type IN ('booking', 'time_submission')"),
    )
    op.create_index(
        "budget_actual_allocations_booking_component_unique",
        "budget_actual_allocations",
        ["organization_id", "booking_charge_component_id"],
        unique=True,
        postgresql_where=sa.text("booking_charge_component_id IS NOT NULL"),
    )
    op.execute("DROP TRIGGER IF EXISTS budget_actual_allocations_tenant_links ON budget_actual_allocations")
    op.execute(
        """
        CREATE TRIGGER budget_actual_allocations_tenant_links BEFORE INSERT OR UPDATE ON budget_actual_allocations
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_tenant_links(
          'budget_line_id', 'budget_lines', 'booking_id', 'bookings',
          'booking_charge_component_id', 'booking_charge_components',
          'work_order_id', 'post_work_orders', 'vendor_invoice_id', 'vendor_invoices'
        )
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.postpilot_enforce_budget_component_booking()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE component_booking uuid;
        BEGIN
          IF NEW.booking_charge_component_id IS NULL THEN
            RETURN NEW;
          END IF;
          SELECT booking_id INTO component_booking
          FROM booking_charge_components WHERE id = NEW.booking_charge_component_id;
          IF component_booking IS NULL OR component_booking <> NEW.booking_id THEN
            RAISE EXCEPTION 'budget component allocation must use the component booking';
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER budget_actual_allocations_component_booking
        BEFORE INSERT OR UPDATE ON budget_actual_allocations
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_budget_component_booking()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS budget_actual_allocations_component_booking ON budget_actual_allocations")
    op.execute("DROP FUNCTION IF EXISTS public.postpilot_enforce_budget_component_booking()")
    op.execute("DROP TRIGGER IF EXISTS budget_actual_allocations_tenant_links ON budget_actual_allocations")
    op.execute(
        """
        CREATE TRIGGER budget_actual_allocations_tenant_links BEFORE INSERT OR UPDATE ON budget_actual_allocations
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_tenant_links(
          'budget_line_id', 'budget_lines', 'booking_id', 'bookings', 'work_order_id', 'post_work_orders',
          'vendor_invoice_id', 'vendor_invoices'
        )
        """
    )
    op.drop_index("budget_actual_allocations_booking_component_unique", table_name="budget_actual_allocations")
    op.drop_index("budget_actual_allocations_booking_unique", table_name="budget_actual_allocations")
    op.create_index(
        "budget_actual_allocations_booking_unique",
        "budget_actual_allocations",
        ["organization_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("booking_id IS NOT NULL"),
    )
    op.drop_constraint("budget_actual_allocations_one_source_check", "budget_actual_allocations", type_="check")
    op.create_check_constraint(
        "budget_actual_allocations_one_source_check",
        "budget_actual_allocations",
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
    )
    op.drop_constraint(
        "budget_actual_allocations_booking_component_id_fkey",
        "budget_actual_allocations",
        type_="foreignkey",
    )
    op.drop_column("budget_actual_allocations", "booking_charge_component_id")
