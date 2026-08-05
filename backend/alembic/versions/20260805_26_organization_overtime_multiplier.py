"""Make the organisation overtime uplift an explicit commercial setting.

Revision ID: 20260805_26
Revises: 20260805_25
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_26"
down_revision: str | Sequence[str] | None = "20260805_25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("overtime_multiplier", sa.Numeric(6, 3), nullable=False, server_default="1.500"),
    )
    op.create_check_constraint(
        "organizations_overtime_multiplier_check",
        "organizations",
        "overtime_multiplier >= 1 AND overtime_multiplier <= 10",
    )


def downgrade() -> None:
    op.drop_constraint("organizations_overtime_multiplier_check", "organizations", type_="check")
    op.drop_column("organizations", "overtime_multiplier")
