"""Flag historic commercial records whose treatment was never confirmed.

Revision ID: 20260805_34
Revises: 20260805_33
Create Date: 2026-08-05

The original treatment migration retained ``wet_hire`` as a database
compatibility value for existing rows. That value is not evidence of the
agreement that applied at the time. This migration preserves every historic
booking, work order, actual and invoice exactly as recorded, and only creates
a visible commercial-review flag where a deliberate treatment snapshot is
absent. It never consults current rate cards or resource records.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260805_34"
down_revision: str | Sequence[str] | None = "20260805_33"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "post_work_orders",
        sa.Column("commercial_review_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("post_work_orders", sa.Column("commercial_review_reason", sa.Text()))
    op.add_column("post_work_orders", sa.Column("commercial_review_marked_at", sa.DateTime(timezone=True)))
    op.create_index(
        "post_work_orders_organization_commercial_review_idx",
        "post_work_orders",
        ["organization_id", "commercial_review_required"],
        postgresql_where=sa.text("commercial_review_required IS TRUE"),
    )

    # Do not reinterpret old wet-hire defaults as an actual commercial choice.
    # Existing rate snapshots, actual time and invoices remain untouched.
    op.execute(
        """
        UPDATE bookings
        SET commercial_review_required = TRUE,
            commercial_review_reason = COALESCE(
                commercial_review_reason,
                'Historic booking has no confirmed commercial treatment snapshot.'
            ),
            commercial_review_marked_at = COALESCE(commercial_review_marked_at, now())
        WHERE commercial_treatment_snapshot_at IS NULL
        """
    )
    op.execute(
        """
        UPDATE post_work_orders
        SET commercial_review_required = TRUE,
            commercial_review_reason = 'Historic work order has no confirmed commercial treatment snapshot.',
            commercial_review_marked_at = now()
        WHERE commercial_treatment_snapshot_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("post_work_orders_organization_commercial_review_idx", table_name="post_work_orders")
    op.drop_column("post_work_orders", "commercial_review_marked_at")
    op.drop_column("post_work_orders", "commercial_review_reason")
    op.drop_column("post_work_orders", "commercial_review_required")
