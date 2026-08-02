"""Separate work-order occupancy from client billing and add OT snapshots.

Revision ID: 20260802_13
Revises: 20260731_12
Create Date: 2026-08-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260802_13"
down_revision: str | Sequence[str] | None = "20260731_12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Ten hours is the conservative television-post default.  It affects new
    # work-order snapshots only; historical estimates and bookings are left as
    # they were recorded.
    op.add_column(
        "organizations",
        sa.Column("standard_day_hours", sa.Numeric(5, 2), nullable=False, server_default="10.00"),
    )
    op.create_check_constraint(
        "organizations_standard_day_hours_check",
        "organizations",
        "standard_day_hours >= 1 AND standard_day_hours <= 24",
    )

    op.add_column("post_work_orders", sa.Column("planned_duration_quantity", sa.Numeric(12, 2)))
    op.add_column("post_work_orders", sa.Column("planned_duration_unit", sa.Text()))
    op.add_column("post_work_orders", sa.Column("standard_day_hours_snapshot", sa.Numeric(5, 2)))
    op.add_column(
        "post_work_orders",
        sa.Column("allow_overtime_billing", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("post_work_orders", sa.Column("overtime_multiplier", sa.Numeric(7, 3)))
    op.add_column("post_work_orders", sa.Column("overtime_hourly_base_rate", sa.Numeric(14, 4)))
    op.create_check_constraint(
        "post_work_orders_planned_duration_check",
        "post_work_orders",
        "(planned_duration_quantity IS NULL AND planned_duration_unit IS NULL) "
        "OR (planned_duration_quantity > 0 AND planned_duration_unit IN ('hour', 'half_day', 'day', 'week'))",
    )
    op.create_check_constraint(
        "post_work_orders_overtime_policy_check",
        "post_work_orders",
        "(allow_overtime_billing = false AND overtime_multiplier IS NULL AND overtime_hourly_base_rate IS NULL) "
        "OR (allow_overtime_billing = true AND overtime_multiplier > 0 AND overtime_hourly_base_rate >= 0 "
        "AND planned_duration_quantity IS NOT NULL AND standard_day_hours_snapshot > 0)",
    )


def downgrade() -> None:
    op.drop_constraint("post_work_orders_overtime_policy_check", "post_work_orders", type_="check")
    op.drop_constraint("post_work_orders_planned_duration_check", "post_work_orders", type_="check")
    op.drop_column("post_work_orders", "overtime_hourly_base_rate")
    op.drop_column("post_work_orders", "overtime_multiplier")
    op.drop_column("post_work_orders", "allow_overtime_billing")
    op.drop_column("post_work_orders", "standard_day_hours_snapshot")
    op.drop_column("post_work_orders", "planned_duration_unit")
    op.drop_column("post_work_orders", "planned_duration_quantity")
    op.drop_constraint("organizations_standard_day_hours_check", "organizations", type_="check")
    op.drop_column("organizations", "standard_day_hours")
