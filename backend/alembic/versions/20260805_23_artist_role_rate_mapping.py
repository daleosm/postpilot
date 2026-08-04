"""Map generic artist service rates to tenant-configured operational roles.

Revision ID: 20260805_23
Revises: 20260804_22
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_23"
down_revision: str | Sequence[str] | None = "20260804_22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("service_rates", sa.Column("artist_role", sa.Text(), nullable=True))
    op.add_column("rate_card_items", sa.Column("artist_role", sa.Text(), nullable=True))
    op.create_index(
        "service_rates_organization_artist_role_idx",
        "service_rates",
        ["organization_id", "artist_role"],
        postgresql_where=sa.text("artist_role IS NOT NULL"),
    )
    op.create_index(
        "rate_card_items_card_artist_role_unit_idx",
        "rate_card_items",
        ["rate_card_id", "artist_role", "unit"],
        postgresql_where=sa.text("target_type = 'service' AND artist_role IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("rate_card_items_card_artist_role_unit_idx", table_name="rate_card_items")
    op.drop_index("service_rates_organization_artist_role_idx", table_name="service_rates")
    op.drop_column("rate_card_items", "artist_role")
    op.drop_column("service_rates", "artist_role")
