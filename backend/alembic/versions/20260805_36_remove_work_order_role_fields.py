"""Remove retired work-order department and role assignment fields.

Revision ID: 20260805_36
Revises: 20260805_35
Create Date: 2026-08-05

Work orders are assigned to one named person or remain unassigned. Department
and role-wide routing were removed from the operational model, so retaining
these nullable columns would leave misleading and inactive data behind.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_36"
down_revision: str | Sequence[str] | None = "20260805_35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("workflow_stage_work_order_templates", "assignee_role")
    op.drop_column("workflow_stage_work_order_templates", "department")
    op.drop_column("post_work_orders", "assignee_role")
    op.drop_column("post_work_orders", "department")


def downgrade() -> None:
    op.add_column("post_work_orders", sa.Column("department", sa.Text()))
    op.add_column("post_work_orders", sa.Column("assignee_role", sa.Text()))
    op.add_column("workflow_stage_work_order_templates", sa.Column("department", sa.Text()))
    op.add_column("workflow_stage_work_order_templates", sa.Column("assignee_role", sa.Text()))
