"""Remove the obsolete work-order priority model.

Revision ID: 20260808_41
Revises: 20260806_40
Create Date: 2026-08-08
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260808_41"
down_revision = "20260806_40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("workflow_stage_work_order_templates", "priority")
    op.drop_column("post_work_orders", "priority")
    op.execute("DROP TYPE IF EXISTS work_order_priority")


def downgrade() -> None:
    priority = postgresql.ENUM("blocker", "high", "normal", "low", name="work_order_priority", create_type=False)
    priority.create(op.get_bind(), checkfirst=True)
    for table in ("workflow_stage_work_order_templates", "post_work_orders"):
        op.add_column(
            table,
            sa.Column(
                "priority",
                priority,
                nullable=False,
                server_default="normal",
            ),
        )
        op.alter_column(table, "priority", server_default=None)
