"""Make each booking-rate snapshot's commercial scope explicit.

Revision ID: 20260804_18
Revises: 20260804_17
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_18"
down_revision: str | Sequence[str] | None = "20260804_17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "booking_charge_components",
        sa.Column("rate_card_scope", sa.Text(), nullable=False, server_default="facility"),
    )
    op.execute(
        """
        UPDATE booking_charge_components
        SET rate_card_scope = CASE rate_source
          WHEN 'master_rate_card' THEN 'master'
          WHEN 'network_rate_card' THEN 'network'
          WHEN 'client_rate_card' THEN 'client'
          WHEN 'show_rate_card' THEN 'show'
          WHEN 'episode_rate_card' THEN 'episode'
          WHEN 'negotiated_booking_override' THEN 'booking_override'
          ELSE 'facility'
        END
        """
    )
    op.alter_column("booking_charge_components", "rate_card_scope", server_default=None)


def downgrade() -> None:
    op.drop_column("booking_charge_components", "rate_card_scope")
