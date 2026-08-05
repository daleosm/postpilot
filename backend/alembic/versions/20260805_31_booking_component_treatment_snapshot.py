"""Make every booking charge snapshot self-describing.

Revision ID: 20260805_31
Revises: 20260805_30
Create Date: 2026-08-05

Confirmed booking charge components are used independently by actual-time,
invoice, and audit reads. Persist the parent booking's commercial treatment on
each component so those reads do not need to infer it from mutable operational
data. Historic components predate the treatment model and safely retain the
wet-hire compatibility value.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260805_31"
down_revision: str | Sequence[str] | None = "20260805_30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TREATMENTS = "commercial_treatment IN ('wet_hire', 'dry_hire', 'flat_project_fee')"


def upgrade() -> None:
    op.add_column(
        "booking_charge_components",
        sa.Column("commercial_treatment", sa.Text(), nullable=False, server_default="wet_hire"),
    )
    op.create_check_constraint(
        "booking_charge_components_commercial_treatment_check",
        "booking_charge_components",
        _TREATMENTS,
    )
    op.alter_column("booking_charge_components", "commercial_treatment", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "booking_charge_components_commercial_treatment_check",
        "booking_charge_components",
        type_="check",
    )
    op.drop_column("booking_charge_components", "commercial_treatment")
