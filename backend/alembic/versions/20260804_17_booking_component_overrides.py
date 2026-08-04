"""Add negotiated booking-component commercial snapshots.

Revision ID: 20260804_17
Revises: 20260804_16
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_17"
down_revision: str | Sequence[str] | None = "20260804_16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "booking_charge_components",
        sa.Column("is_negotiated_override", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("booking_charge_components", sa.Column("override_reason", sa.Text(), nullable=True))
    op.add_column(
        "booking_charge_components",
        sa.Column("overridden_by_user_id", sa.Text(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("booking_charge_components", sa.Column("overridden_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "booking_charge_components_override_reason_check",
        "booking_charge_components",
        "(is_negotiated_override IS FALSE AND override_reason IS NULL) "
        "OR (is_negotiated_override IS TRUE AND override_reason IS NOT NULL)",
    )
    op.alter_column("booking_charge_components", "is_negotiated_override", server_default=None)


def downgrade() -> None:
    op.drop_constraint("booking_charge_components_override_reason_check", "booking_charge_components", type_="check")
    op.drop_column("booking_charge_components", "overridden_at")
    op.drop_column("booking_charge_components", "overridden_by_user_id")
    op.drop_column("booking_charge_components", "override_reason")
    op.drop_column("booking_charge_components", "is_negotiated_override")
