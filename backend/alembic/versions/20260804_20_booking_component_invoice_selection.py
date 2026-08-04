"""Select confirmed booking components for itemised client invoicing.

Revision ID: 20260804_20
Revises: 20260804_19
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260804_20"
down_revision: str | Sequence[str] | None = "20260804_19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "booking_charge_components",
        "actual_quantity",
        type_=sa.Numeric(14, 6),
        postgresql_using="actual_quantity::numeric(14,6)",
    )
    op.alter_column(
        "booking_charge_components",
        "actual_overtime_quantity",
        type_=sa.Numeric(14, 6),
        postgresql_using="actual_overtime_quantity::numeric(14,6)",
    )
    op.create_table(
        "booking_component_invoice_selections",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "booking_charge_component_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("booking_charge_components.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("include_in_invoice", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("selected_by_user_id", sa.Text(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("selected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "include_in_invoice IS TRUE OR reason IS NOT NULL",
            name="booking_component_invoice_selection_reason_check",
        ),
        sa.UniqueConstraint(
            "booking_charge_component_id",
            name="booking_component_invoice_selections_component_unique",
        ),
    )
    op.create_index(
        "booking_component_invoice_selections_organization_component_idx",
        "booking_component_invoice_selections",
        ["organization_id", "booking_charge_component_id"],
    )
    op.alter_column(
        "client_invoice_items",
        "quantity",
        type_=sa.Numeric(14, 6),
        postgresql_using="quantity::numeric(14,6)",
    )
    op.add_column(
        "client_invoice_items",
        sa.Column(
            "booking_charge_component_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("booking_charge_components.id", ondelete="RESTRICT"),
        ),
    )
    op.add_column("client_invoice_items", sa.Column("booking_component_charge_kind", sa.Text()))
    op.create_check_constraint(
        "client_invoice_items_booking_component_kind_check",
        "client_invoice_items",
        "(booking_charge_component_id IS NULL AND booking_component_charge_kind IS NULL) "
        "OR (booking_charge_component_id IS NOT NULL AND booking_component_charge_kind IN ('base', 'overtime'))",
    )
    op.create_unique_constraint(
        "client_invoice_items_booking_component_charge_unique",
        "client_invoice_items",
        ["booking_charge_component_id", "booking_component_charge_kind"],
    )


def downgrade() -> None:
    op.drop_constraint("client_invoice_items_booking_component_charge_unique", "client_invoice_items", type_="unique")
    op.drop_constraint("client_invoice_items_booking_component_kind_check", "client_invoice_items", type_="check")
    op.drop_column("client_invoice_items", "booking_component_charge_kind")
    op.drop_column("client_invoice_items", "booking_charge_component_id")
    op.alter_column(
        "client_invoice_items",
        "quantity",
        type_=sa.Numeric(12, 3),
        postgresql_using="quantity::numeric(12,3)",
    )
    op.drop_index(
        "booking_component_invoice_selections_organization_component_idx",
        table_name="booking_component_invoice_selections",
    )
    op.drop_table("booking_component_invoice_selections")
    op.alter_column(
        "booking_charge_components",
        "actual_overtime_quantity",
        type_=sa.Numeric(14, 2),
        postgresql_using="actual_overtime_quantity::numeric(14,2)",
    )
    op.alter_column(
        "booking_charge_components",
        "actual_quantity",
        type_=sa.Numeric(14, 2),
        postgresql_using="actual_quantity::numeric(14,2)",
    )
