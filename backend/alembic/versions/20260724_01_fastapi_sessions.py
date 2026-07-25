"""Add opaque FastAPI sessions.

Revision ID: 20260724_01
Revises: 20260724_00
Create Date: 2026-07-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260724_01"
down_revision: str | Sequence[str] | None = "20260724_00"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_sessions",
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("impersonated_user_id", sa.Text(), nullable=True),
        sa.Column("active_organization_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("active_show_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["active_organization_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["active_show_id"], ["shows.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["impersonated_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index("api_sessions_user_id_idx", "api_sessions", ["user_id"])
    op.create_index("api_sessions_expires_at_idx", "api_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("api_sessions_expires_at_idx", table_name="api_sessions")
    op.drop_index("api_sessions_user_id_idx", table_name="api_sessions")
    op.drop_table("api_sessions")
