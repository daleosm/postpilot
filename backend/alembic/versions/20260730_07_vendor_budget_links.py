"""Attach vendor work and supplier invoices to planned external budget items.

Revision ID: 20260730_07
Revises: 20260730_06
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260730_07"
down_revision: str | Sequence[str] | None = "20260730_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("post_work_orders", sa.Column("budget_line_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key(
        "post_work_orders_budget_line_id_fkey",
        "post_work_orders",
        "budget_lines",
        ["budget_line_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "post_work_orders_tenant_episode_budget_line_idx",
        "post_work_orders",
        ["organization_id", "episode_id", "budget_line_id"],
    )
    op.add_column("vendor_invoices", sa.Column("budget_line_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key(
        "vendor_invoices_budget_line_id_fkey",
        "vendor_invoices",
        "budget_lines",
        ["budget_line_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "vendor_invoices_tenant_episode_budget_line_idx",
        "vendor_invoices",
        ["organization_id", "episode_id", "budget_line_id"],
    )

    # Preserve historic associations. New code writes the links on the source
    # record; the old columns on budget_lines remain read-only compatibility.
    op.execute(
        """
        UPDATE vendor_invoices invoice
        SET budget_line_id = line.id
        FROM budget_lines line
        WHERE line.vendor_invoice_id = invoice.id
          AND line.organization_id = invoice.organization_id
          AND line.episode_id = invoice.episode_id
          AND line.external_cost = true
          AND invoice.budget_line_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE post_work_orders work_order
        SET budget_line_id = source.id
        FROM (
          SELECT work_order_id, min(id::text)::uuid AS id
          FROM budget_lines
          WHERE work_order_id IS NOT NULL AND external_cost = true
          GROUP BY work_order_id
          HAVING count(*) = 1
        ) source
        WHERE work_order.id = source.work_order_id
          AND work_order.organization_id = (
            SELECT organization_id FROM budget_lines WHERE id = source.id
          )
          AND work_order.episode_id = (
            SELECT episode_id FROM budget_lines WHERE id = source.id
          )
          AND work_order.budget_line_id IS NULL
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.postpilot_enforce_vendor_budget_line()
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
            RAISE EXCEPTION 'vendor budget item must belong to the same organization';
          END IF;
          IF budget_episode IS NULL OR budget_episode <> NEW.episode_id THEN
            RAISE EXCEPTION 'vendor budget item must belong to the linked episode';
          END IF;
          IF NOT budget_external THEN
            RAISE EXCEPTION 'vendor work and invoices require an external-cost budget item';
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER post_work_orders_vendor_budget_line_scope
        BEFORE INSERT OR UPDATE ON post_work_orders
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_vendor_budget_line()
        """
    )
    op.execute(
        """
        CREATE TRIGGER vendor_invoices_budget_line_scope
        BEFORE INSERT OR UPDATE ON vendor_invoices
        FOR EACH ROW EXECUTE FUNCTION public.postpilot_enforce_vendor_budget_line()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS vendor_invoices_budget_line_scope ON vendor_invoices")
    op.execute("DROP TRIGGER IF EXISTS post_work_orders_vendor_budget_line_scope ON post_work_orders")
    op.execute("DROP FUNCTION IF EXISTS public.postpilot_enforce_vendor_budget_line()")
    op.drop_index("vendor_invoices_tenant_episode_budget_line_idx", table_name="vendor_invoices")
    op.drop_constraint("vendor_invoices_budget_line_id_fkey", "vendor_invoices", type_="foreignkey")
    op.drop_column("vendor_invoices", "budget_line_id")
    op.drop_index("post_work_orders_tenant_episode_budget_line_idx", table_name="post_work_orders")
    op.drop_constraint("post_work_orders_budget_line_id_fkey", "post_work_orders", type_="foreignkey")
    op.drop_column("post_work_orders", "budget_line_id")
