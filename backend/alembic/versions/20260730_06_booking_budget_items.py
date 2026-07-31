"""Link operational bookings to episode budget items.

Revision ID: 20260730_06
Revises: 20260730_05
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260730_06"
down_revision: str | Sequence[str] | None = "20260730_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A time submission is the booking's actual.  Older rows used the source
    # name ``time_submission`` while new rows use ``booking``; uniqueness must
    # cover both names so one booking cannot double-count actual cost.
    op.drop_index("budget_actual_allocations_booking_unique", table_name="budget_actual_allocations")
    op.create_index(
        "budget_actual_allocations_booking_unique",
        "budget_actual_allocations",
        ["organization_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("booking_id IS NOT NULL"),
    )
    op.add_column("bookings", sa.Column("budget_line_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key(
        "bookings_budget_line_id_fkey",
        "bookings",
        "budget_lines",
        ["budget_line_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "bookings_tenant_episode_budget_line_idx",
        "bookings",
        ["organization_id", "episode_id", "budget_line_id"],
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.postpilot_enforce_booking_budget_line()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE budget_org uuid;
        DECLARE budget_episode uuid;
        DECLARE budget_external boolean;
        BEGIN
          IF NEW.budget_line_id IS NULL THEN
            RETURN NEW;
          END IF;
          SELECT organization_id, episode_id, external_cost
          INTO budget_org, budget_episode, budget_external
          FROM budget_lines WHERE id = NEW.budget_line_id;
          IF budget_org IS NULL OR budget_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'booking budget item must belong to the booking organization';
          END IF;
          IF NEW.episode_id IS NULL OR budget_episode IS NULL OR budget_episode <> NEW.episode_id THEN
            RAISE EXCEPTION 'booking budget item must belong to the linked episode';
          END IF;
          IF budget_external THEN
            RAISE EXCEPTION 'external-cost budget items cannot be used by internal bookings';
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER bookings_budget_line_scope BEFORE INSERT OR UPDATE ON bookings
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_booking_budget_line()
        """
    )
    # Existing work-order reservations retain their commercial context when a
    # unique internal episode budget item is already linked to that work order.
    op.execute(
        """
        UPDATE bookings b
        SET budget_line_id = source.id
        FROM (
          SELECT b2.id AS booking_id, min(bl.id::text)::uuid AS id
          FROM bookings b2
          JOIN post_work_orders wo
            ON wo.booking_id = b2.id AND wo.organization_id = b2.organization_id
          JOIN budget_lines bl
            ON bl.work_order_id = wo.id
           AND bl.organization_id = b2.organization_id
           AND bl.episode_id = b2.episode_id
           AND bl.external_cost = false
          GROUP BY b2.id
          HAVING count(bl.id) = 1
        ) source
        WHERE b.id = source.booking_id
          AND b.budget_line_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS bookings_budget_line_scope ON bookings")
    op.execute("DROP FUNCTION IF EXISTS public.postpilot_enforce_booking_budget_line()")
    op.drop_index("bookings_tenant_episode_budget_line_idx", table_name="bookings")
    op.drop_constraint("bookings_budget_line_id_fkey", "bookings", type_="foreignkey")
    op.drop_column("bookings", "budget_line_id")
    op.drop_index("budget_actual_allocations_booking_unique", table_name="budget_actual_allocations")
    op.create_index(
        "budget_actual_allocations_booking_unique",
        "budget_actual_allocations",
        ["organization_id", "booking_id", "source_type"],
        unique=True,
        postgresql_where=sa.text("booking_id IS NOT NULL"),
    )
