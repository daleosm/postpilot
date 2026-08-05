"""Keep the historic commercial-review flag safe for direct inserts.

Revision ID: 20260805_35
Revises: 20260805_34
Create Date: 2026-08-05

The review marker is an opt-in attention state.  Records created outside the
HTTP API (data imports, tests, or carefully controlled support scripts) must
therefore receive ``FALSE`` rather than failing or being silently flagged.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_35"
down_revision: str | Sequence[str] | None = "20260805_34"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("post_work_orders", "commercial_review_required", server_default=sa.false())


def downgrade() -> None:
    op.alter_column("post_work_orders", "commercial_review_required", server_default=None)
