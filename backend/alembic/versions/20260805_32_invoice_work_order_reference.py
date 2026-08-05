"""Retain work-order references on booking-derived invoice lines.

Revision ID: 20260805_32
Revises: 20260805_31
Create Date: 2026-08-05

An invoice must remain understandable after an operational booking or its work
order has been edited.  The ID gives an auditable link while the text preserves
the human reference that was agreed when the invoice was issued.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_32"
down_revision: str | Sequence[str] | None = "20260805_31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("client_invoice_items", sa.Column("source_work_order_id", sa.UUID(), nullable=True))
    op.add_column("client_invoice_items", sa.Column("source_work_order_reference", sa.Text(), nullable=True))
    op.create_foreign_key(
        "client_invoice_items_source_work_order_id_fkey",
        "client_invoice_items",
        "post_work_orders",
        ["source_work_order_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "client_invoice_items_source_work_order_id_fkey",
        "client_invoice_items",
        type_="foreignkey",
    )
    op.drop_column("client_invoice_items", "source_work_order_reference")
    op.drop_column("client_invoice_items", "source_work_order_id")
