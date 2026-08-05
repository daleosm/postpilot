"""Add explicit wet-hire, dry-hire, and flat-project-fee treatment snapshots.

Revision ID: 20260805_28
Revises: 20260805_27
Create Date: 2026-08-05

Commercial treatment describes how a booking or work order is sold, rather
than what operational resources happen to be scheduled. Existing records keep
their historical values and are conservatively marked wet hire; no historical
price or resource is invented by this migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_28"
down_revision: str | Sequence[str] | None = "20260805_27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TREATMENT_CHECK = "commercial_treatment IN ('wet_hire', 'dry_hire', 'flat_project_fee')"


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("commercial_treatment", sa.Text(), nullable=False, server_default="wet_hire"),
    )
    op.add_column("bookings", sa.Column("client_quote_amount", sa.Numeric(14, 2), nullable=True))
    op.add_column("bookings", sa.Column("client_quote_currency", sa.Text(), nullable=True))
    op.add_column("bookings", sa.Column("commercial_treatment_snapshot_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("bookings_commercial_treatment_check", "bookings", _TREATMENT_CHECK)
    op.create_check_constraint(
        "bookings_client_quote_amount_non_negative_check",
        "bookings",
        "client_quote_amount IS NULL OR client_quote_amount >= 0",
    )

    op.add_column(
        "post_work_orders",
        sa.Column("commercial_treatment", sa.Text(), nullable=False, server_default="wet_hire"),
    )
    op.add_column("post_work_orders", sa.Column("commercial_treatment_snapshot_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("post_work_orders_commercial_treatment_check", "post_work_orders", _TREATMENT_CHECK)


def downgrade() -> None:
    op.drop_constraint("post_work_orders_commercial_treatment_check", "post_work_orders", type_="check")
    op.drop_column("post_work_orders", "commercial_treatment_snapshot_at")
    op.drop_column("post_work_orders", "commercial_treatment")

    op.drop_constraint("bookings_client_quote_amount_non_negative_check", "bookings", type_="check")
    op.drop_constraint("bookings_commercial_treatment_check", "bookings", type_="check")
    op.drop_column("bookings", "commercial_treatment_snapshot_at")
    op.drop_column("bookings", "client_quote_currency")
    op.drop_column("bookings", "client_quote_amount")
    op.drop_column("bookings", "commercial_treatment")
