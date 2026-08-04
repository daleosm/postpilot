"""Record actual room and artist booking charges from confirmed snapshots.

Revision ID: 20260804_19
Revises: 20260804_18
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260804_19"
down_revision: str | Sequence[str] | None = "20260804_18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("booking_charge_components", sa.Column("actual_quantity", sa.Numeric(14, 2), nullable=True))
    op.add_column(
        "booking_charge_components",
        sa.Column("actual_overtime_quantity", sa.Numeric(14, 2), nullable=False, server_default="0"),
    )
    op.add_column("booking_charge_components", sa.Column("actual_client_amount", sa.Numeric(14, 2), nullable=True))
    op.add_column("booking_charge_components", sa.Column("actual_internal_amount", sa.Numeric(14, 2), nullable=True))
    op.add_column(
        "booking_charge_components",
        sa.Column("overtime_multiplier", sa.Numeric(6, 3), nullable=False, server_default="1.5"),
    )
    op.add_column(
        "booking_charge_components",
        sa.Column("actual_submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "booking_charge_components_actual_quantity_non_negative_check",
        "booking_charge_components",
        "actual_quantity IS NULL OR actual_quantity >= 0",
    )
    op.create_check_constraint(
        "booking_charge_components_actual_overtime_non_negative_check",
        "booking_charge_components",
        "actual_overtime_quantity >= 0",
    )
    op.create_check_constraint(
        "booking_charge_components_actual_client_non_negative_check",
        "booking_charge_components",
        "actual_client_amount IS NULL OR actual_client_amount >= 0",
    )
    op.create_check_constraint(
        "booking_charge_components_actual_internal_non_negative_check",
        "booking_charge_components",
        "actual_internal_amount IS NULL OR actual_internal_amount >= 0",
    )
    op.create_check_constraint(
        "booking_charge_components_overtime_multiplier_check",
        "booking_charge_components",
        "overtime_multiplier >= 1",
    )
    op.alter_column("booking_charge_components", "actual_overtime_quantity", server_default=None)
    op.alter_column("booking_charge_components", "overtime_multiplier", server_default=None)


def downgrade() -> None:
    for name in (
        "booking_charge_components_overtime_multiplier_check",
        "booking_charge_components_actual_internal_non_negative_check",
        "booking_charge_components_actual_client_non_negative_check",
        "booking_charge_components_actual_overtime_non_negative_check",
        "booking_charge_components_actual_quantity_non_negative_check",
    ):
        op.drop_constraint(name, "booking_charge_components", type_="check")
    for name in (
        "actual_submitted_at",
        "overtime_multiplier",
        "actual_internal_amount",
        "actual_client_amount",
        "actual_overtime_quantity",
        "actual_quantity",
    ):
        op.drop_column("booking_charge_components", name)
