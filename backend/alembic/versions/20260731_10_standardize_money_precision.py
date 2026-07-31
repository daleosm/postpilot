"""Standardise persisted monetary values to NUMERIC(14, 2).

Revision ID: 20260731_10
Revises: 20260730_09
Create Date: 2026-07-31

The affected columns were already fixed-scale monetary fields. Widening their
precision is lossless and keeps the physical schema aligned with the rest of
the commercial ledger: maximum two decimal places, with sufficient headroom
for large facility budgets.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260731_10"
down_revision: str | Sequence[str] | None = "20260730_09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table, column, previous_precision in (
        ("people", "hourly_rate", 10),
        ("people", "day_rate", 10),
        ("catering_requests", "actual_cost", 12),
        ("catering_requests", "billed_amount", 12),
    ):
        op.alter_column(
            table,
            column,
            existing_type=sa.Numeric(previous_precision, 2),
            type_=sa.Numeric(14, 2),
            postgresql_using=f"{column}::numeric(14,2)",
        )


def downgrade() -> None:
    # Downgrade is intentionally conservative: shrinking a money column could
    # lose valid higher-value ledger data written after this migration.
    pass
