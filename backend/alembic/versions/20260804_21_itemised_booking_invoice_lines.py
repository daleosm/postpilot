"""Persist booking-line invoice snapshots and immutable reversals.

Revision ID: 20260804_21
Revises: 20260804_20
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260804_21"
down_revision: str | Sequence[str] | None = "20260804_20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "client_invoice_items",
        sa.Column(
            "source_booking_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("bookings.id", ondelete="RESTRICT"),
        ),
    )
    op.add_column("client_invoice_items", sa.Column("booking_date", sa.Date()))
    op.add_column("client_invoice_items", sa.Column("episode_code", sa.Text()))
    op.add_column("client_invoice_items", sa.Column("episode_title", sa.Text()))
    op.add_column("client_invoice_items", sa.Column("resource_type", sa.Text()))
    op.add_column("client_invoice_items", sa.Column("resource_name", sa.Text()))
    op.add_column("client_invoice_items", sa.Column("saved_rate", sa.Numeric(14, 2)))
    op.add_column("client_invoice_items", sa.Column("overtime_multiplier", sa.Numeric(7, 3)))
    op.add_column("client_invoice_items", sa.Column("voided_at", sa.DateTime(timezone=True)))
    op.add_column(
        "client_invoice_items",
        sa.Column("voided_by_user_id", sa.Text(), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.drop_constraint("client_invoice_items_booking_component_charge_unique", "client_invoice_items", type_="unique")
    op.create_index(
        "client_invoice_items_active_booking_component_charge_unique",
        "client_invoice_items",
        ["booking_charge_component_id", "booking_component_charge_kind"],
        unique=True,
        postgresql_where=sa.text("booking_charge_component_id IS NOT NULL AND voided_at IS NULL"),
    )
    op.create_table(
        "client_invoice_line_reversals",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "client_invoice_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("client_invoices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "client_invoice_item_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("client_invoice_items.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reversal_type", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 6), nullable=False),
        sa.Column("unit_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Text(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("reversal_type IN ('void', 'credit')", name="client_invoice_line_reversals_type_check"),
        sa.CheckConstraint(
            "quantity > 0 AND unit_amount >= 0 AND amount < 0",
            name="client_invoice_line_reversals_amount_check",
        ),
        sa.UniqueConstraint("client_invoice_item_id", name="client_invoice_line_reversals_item_unique"),
    )
    op.create_index(
        "client_invoice_line_reversals_organization_invoice_idx",
        "client_invoice_line_reversals",
        ["organization_id", "client_invoice_id"],
    )


def downgrade() -> None:
    op.drop_index("client_invoice_line_reversals_organization_invoice_idx", table_name="client_invoice_line_reversals")
    op.drop_table("client_invoice_line_reversals")
    op.drop_index("client_invoice_items_active_booking_component_charge_unique", table_name="client_invoice_items")
    op.create_unique_constraint(
        "client_invoice_items_booking_component_charge_unique",
        "client_invoice_items",
        ["booking_charge_component_id", "booking_component_charge_kind"],
    )
    op.drop_column("client_invoice_items", "voided_by_user_id")
    op.drop_column("client_invoice_items", "voided_at")
    op.drop_column("client_invoice_items", "overtime_multiplier")
    op.drop_column("client_invoice_items", "saved_rate")
    op.drop_column("client_invoice_items", "resource_name")
    op.drop_column("client_invoice_items", "resource_type")
    op.drop_column("client_invoice_items", "episode_title")
    op.drop_column("client_invoice_items", "episode_code")
    op.drop_column("client_invoice_items", "booking_date")
    op.drop_column("client_invoice_items", "source_booking_id")
