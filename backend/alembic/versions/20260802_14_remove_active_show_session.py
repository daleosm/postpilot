"""Remove the obsolete persistent show switcher session state.

Revision ID: 20260802_14
Revises: 20260802_13
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260802_14"
down_revision: str | Sequence[str] | None = "20260802_13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("api_sessions", "active_show_id")


def downgrade() -> None:
    op.add_column(
        "api_sessions",
        sa.Column(
            "active_show_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("shows.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
