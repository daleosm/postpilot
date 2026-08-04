"""Add explicit room and named-person rate-card targets.

Revision ID: 20260804_15
Revises: 20260802_14
Create Date: 2026-08-04

Existing card entries are generic service entries. They keep their current
category/unit identity and rate; no room or person records are generated as a
side effect of this migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260804_15"
down_revision: str | Sequence[str] | None = "20260802_14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rate_card_items",
        sa.Column("target_type", sa.String(length=16), nullable=False, server_default="service"),
    )
    op.add_column(
        "rate_card_items",
        sa.Column(
            "room_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "rate_card_items",
        sa.Column(
            "person_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("people.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column("rate_card_items", sa.Column("internal_cost_rate", sa.Numeric(14, 2), nullable=True))

    # The legacy index represented the generic service identity. Recreate it
    # as a partial unique index, then add one explicit target per card for
    # rooms and named artists.
    op.drop_index("rate_card_items_card_category_unit_idx", table_name="rate_card_items")
    op.create_index(
        "rate_card_items_service_target_unique",
        "rate_card_items",
        ["rate_card_id", "category", "unit"],
        unique=True,
        postgresql_where=sa.text("target_type = 'service'"),
    )
    op.create_index(
        "rate_card_items_room_target_unique",
        "rate_card_items",
        ["rate_card_id", "room_id"],
        unique=True,
        postgresql_where=sa.text("target_type = 'room'"),
    )
    op.create_index(
        "rate_card_items_person_target_unique",
        "rate_card_items",
        ["rate_card_id", "person_id"],
        unique=True,
        postgresql_where=sa.text("target_type = 'person'"),
    )
    op.create_index(
        "rate_card_items_organization_person_idx",
        "rate_card_items",
        ["organization_id", "person_id"],
    )
    op.create_index(
        "rate_card_items_organization_room_idx",
        "rate_card_items",
        ["organization_id", "room_id"],
    )
    op.create_check_constraint(
        "rate_card_items_internal_cost_rate_non_negative_check",
        "rate_card_items",
        "internal_cost_rate IS NULL OR internal_cost_rate >= 0",
    )
    op.create_check_constraint(
        "rate_card_items_target_check",
        "rate_card_items",
        "(target_type = 'service' AND room_id IS NULL AND person_id IS NULL) "
        "OR (target_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL AND service_rate_id IS NULL) "
        "OR (target_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL AND service_rate_id IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("rate_card_items_target_check", "rate_card_items", type_="check")
    op.drop_constraint("rate_card_items_internal_cost_rate_non_negative_check", "rate_card_items", type_="check")
    op.drop_index("rate_card_items_organization_room_idx", table_name="rate_card_items")
    op.drop_index("rate_card_items_organization_person_idx", table_name="rate_card_items")
    op.drop_index("rate_card_items_person_target_unique", table_name="rate_card_items")
    op.drop_index("rate_card_items_room_target_unique", table_name="rate_card_items")
    op.drop_index("rate_card_items_service_target_unique", table_name="rate_card_items")
    op.create_index(
        "rate_card_items_card_category_unit_idx",
        "rate_card_items",
        ["rate_card_id", "category", "unit"],
        unique=True,
    )
    op.drop_column("rate_card_items", "internal_cost_rate")
    op.drop_column("rate_card_items", "person_id")
    op.drop_column("rate_card_items", "room_id")
    op.drop_column("rate_card_items", "target_type")
