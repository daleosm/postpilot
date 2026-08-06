"""Allow each named room or artist rate to carry all supported price units.

Revision ID: 20260806_40
Revises: 20260806_39
Create Date: 2026-08-06
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260806_40"
down_revision: str | Sequence[str] | None = "20260806_39"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("rate_card_items_room_target_unique", table_name="rate_card_items")
    op.drop_index("rate_card_items_person_target_unique", table_name="rate_card_items")
    op.create_index(
        "rate_card_items_room_target_unit_unique",
        "rate_card_items",
        ["rate_card_id", "room_id", "unit"],
        unique=True,
        postgresql_where=sa.text("target_type = 'room'"),
    )
    op.create_index(
        "rate_card_items_person_target_unit_unique",
        "rate_card_items",
        ["rate_card_id", "person_id", "unit"],
        unique=True,
        postgresql_where=sa.text("target_type = 'person'"),
    )


def downgrade() -> None:
    op.drop_index("rate_card_items_person_target_unit_unique", table_name="rate_card_items")
    op.drop_index("rate_card_items_room_target_unit_unique", table_name="rate_card_items")
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
