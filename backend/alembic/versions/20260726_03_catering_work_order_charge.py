"""Link episode-chargeable catering requests to internal work orders.

Revision ID: 20260726_03
Revises: 20260726_02
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260726_03"
down_revision: str | Sequence[str] | None = "20260726_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("catering_requests", sa.Column("work_order_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key(
        "catering_requests_work_order_id_post_work_orders_id_fk",
        "catering_requests",
        "post_work_orders",
        ["work_order_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("catering_requests_work_order_idx", "catering_requests", ["work_order_id"])
    op.execute("DROP TRIGGER IF EXISTS catering_tenant_links ON catering_requests")
    op.execute(
        """
        CREATE TRIGGER catering_tenant_links BEFORE INSERT OR UPDATE ON catering_requests
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_tenant_links(
          'booking_id', 'bookings', 'work_order_id', 'post_work_orders', 'room_id', 'rooms',
          'requested_by_person_id', 'people', 'fulfilled_by_person_id', 'people'
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS catering_tenant_links ON catering_requests")
    op.execute(
        """
        CREATE TRIGGER catering_tenant_links BEFORE INSERT OR UPDATE ON catering_requests
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_tenant_links(
          'booking_id', 'bookings', 'room_id', 'rooms',
          'requested_by_person_id', 'people', 'fulfilled_by_person_id', 'people'
        )
        """
    )
    op.drop_index("catering_requests_work_order_idx", table_name="catering_requests")
    op.drop_constraint(
        "catering_requests_work_order_id_post_work_orders_id_fk",
        "catering_requests",
        type_="foreignkey",
    )
    op.drop_column("catering_requests", "work_order_id")
