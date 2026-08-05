"""Preserve fractional penny unit rates on itemised invoice lines.

Revision ID: 20260805_25
Revises: 20260805_24
Create Date: 2026-08-05

Overtime rates such as 127.37 × 1.5 produce 191.055.  Persisting only two
decimal places makes a correctly rounded line total fail its reconciliation
check.  Amounts and tax remain two-decimal financial boundaries.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_25"
down_revision: str | Sequence[str] | None = "20260805_24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("client_invoice_items", "unit_amount", type_=sa.Numeric(14, 6))
    op.alter_column("client_invoice_line_reversals", "unit_amount", type_=sa.Numeric(14, 6))


def downgrade() -> None:
    op.alter_column("client_invoice_line_reversals", "unit_amount", type_=sa.Numeric(14, 2))
    op.alter_column("client_invoice_items", "unit_amount", type_=sa.Numeric(14, 2))
