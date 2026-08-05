"""Store confirmed room and artist booking-commercial snapshots.

Revision ID: 20260804_16
Revises: 20260804_15
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260804_16"
down_revision: str | Sequence[str] | None = "20260804_15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "booking_charge_components",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "booking_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("bookings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("component_type", sa.Text(), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("rooms.id", ondelete="SET NULL")),
        sa.Column("person_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("people.id", ondelete="SET NULL")),
        sa.Column("resource_name", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("billing_unit", sa.Text(), nullable=False),
        sa.Column("client_rate", sa.Numeric(14, 2), nullable=False),
        sa.Column("internal_cost_rate", sa.Numeric(14, 2)),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("rate_source", sa.Text(), nullable=False),
        sa.Column("rate_card_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("rate_cards.id", ondelete="SET NULL")),
        sa.Column(
            "rate_card_item_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("rate_card_items.id", ondelete="SET NULL"),
        ),
        sa.Column("estimated_quantity", sa.Numeric(14, 2), nullable=False),
        sa.Column("estimated_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("component_type IN ('room', 'person')", name="booking_charge_components_type_check"),
        sa.CheckConstraint("client_rate >= 0", name="booking_charge_components_client_rate_non_negative_check"),
        sa.CheckConstraint(
            "internal_cost_rate IS NULL OR internal_cost_rate >= 0",
            name="booking_charge_components_internal_rate_non_negative_check",
        ),
        sa.CheckConstraint("estimated_quantity >= 0", name="booking_charge_components_quantity_non_negative_check"),
        sa.CheckConstraint("estimated_amount >= 0", name="booking_charge_components_amount_non_negative_check"),
        sa.CheckConstraint(
            "(component_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL) "
            "OR (component_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL)",
            name="booking_charge_components_resource_check",
        ),
        sa.UniqueConstraint("booking_id", "component_type", name="booking_charge_components_booking_type_unique"),
    )
    op.create_index(
        "booking_charge_components_organization_booking_idx",
        "booking_charge_components",
        ["organization_id", "booking_id"],
    )


def downgrade() -> None:
    op.drop_index("booking_charge_components_organization_booking_idx", table_name="booking_charge_components")
    op.drop_table("booking_charge_components")
