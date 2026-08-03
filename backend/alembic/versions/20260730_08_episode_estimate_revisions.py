"""Add immutable episode estimate revisions and their line snapshots.

Revision ID: 20260730_08
Revises: 20260730_07
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260730_08"
down_revision: str | Sequence[str] | None = "20260730_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "episode_budget_estimates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("episode_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("approved_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("approved_by_user_id", sa.Text(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'approved', 'superseded')", name="episode_budget_estimates_status_check"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["episode_id"], ["episodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "organization_id", "episode_id", "revision_number", name="episode_budget_estimates_org_episode_revision_key"
        ),
    )
    op.create_index(
        "episode_budget_estimates_tenant_episode_status_idx",
        "episode_budget_estimates",
        ["organization_id", "episode_id", "status", "revision_number"],
    )
    op.create_index(
        "episode_budget_estimates_one_open_draft_idx",
        "episode_budget_estimates",
        ["organization_id", "episode_id"],
        unique=True,
        postgresql_where=sa.text("status = 'draft'"),
    )
    op.create_index(
        "episode_budget_estimates_one_current_approved_idx",
        "episode_budget_estimates",
        ["organization_id", "episode_id"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
    )
    op.create_table(
        "episode_budget_estimate_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("estimate_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("source_budget_line_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("external_cost", sa.Boolean(), nullable=False),
        sa.Column("planned_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["estimate_id"], ["episode_budget_estimates.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "episode_budget_estimate_items_tenant_estimate_idx",
        "episode_budget_estimate_items",
        ["organization_id", "estimate_id"],
    )
    op.create_index(
        "episode_budget_estimate_items_tenant_source_idx",
        "episode_budget_estimate_items",
        ["organization_id", "source_budget_line_id"],
    )


def downgrade() -> None:
    op.drop_index("episode_budget_estimate_items_tenant_source_idx", table_name="episode_budget_estimate_items")
    op.drop_index("episode_budget_estimate_items_tenant_estimate_idx", table_name="episode_budget_estimate_items")
    op.drop_table("episode_budget_estimate_items")
    op.drop_index("episode_budget_estimates_one_current_approved_idx", table_name="episode_budget_estimates")
    op.drop_index("episode_budget_estimates_one_open_draft_idx", table_name="episode_budget_estimates")
    op.drop_index("episode_budget_estimates_tenant_episode_status_idx", table_name="episode_budget_estimates")
    op.drop_table("episode_budget_estimates")
