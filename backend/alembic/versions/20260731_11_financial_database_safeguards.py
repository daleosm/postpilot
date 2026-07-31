"""Enforce financial-ledger integrity and request idempotency in PostgreSQL.

Revision ID: 20260731_11
Revises: 20260731_10
Create Date: 2026-07-31

The operational API already validates commercial scope.  This migration makes
the most important invariants durable at the database boundary as well: money
cannot become negative in a no-credit ledger, invoice totals must reconcile,
and every mutable external source has one authoritative allocation.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260731_11"
down_revision: str | Sequence[str] | None = "20260731_10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A billable is created from an approved work order.  Keep that source as
    # an actual FK rather than relying only on historical JSON metadata.
    op.add_column("billables", sa.Column("source_work_order_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.execute(
        """
        UPDATE billables AS billable
        SET source_work_order_id = work_order.id
        FROM post_work_orders AS work_order
        WHERE billable.organization_id = work_order.organization_id
          AND billable.rate_snapshot ->> 'workOrderId' = work_order.id::text
        """
    )
    op.create_foreign_key(
        "billables_source_work_order_id_fkey",
        "billables",
        "post_work_orders",
        ["source_work_order_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "billables_org_source_work_order_unique",
        "billables",
        ["organization_id", "source_work_order_id"],
        unique=True,
        postgresql_where=sa.text("source_work_order_id IS NOT NULL"),
    )

    # A vendor source must not be consumed by two vendor POs.  The historical
    # per-PO unique indexes prevented a duplicate within one PO only; the API
    # was already checking tenant-wide, so make that rule durable for retries
    # and concurrent requests too.
    op.create_index(
        "purchase_order_allocations_org_work_order_unique",
        "purchase_order_allocations",
        ["organization_id", "work_order_id"],
        unique=True,
        postgresql_where=sa.text("work_order_id IS NOT NULL"),
    )
    op.create_index(
        "purchase_order_allocations_org_vendor_invoice_unique",
        "purchase_order_allocations",
        ["organization_id", "vendor_invoice_id"],
        unique=True,
        postgresql_where=sa.text("vendor_invoice_id IS NOT NULL"),
    )

    # Credits and negative revisions are intentionally not supported yet.
    # They need a future credit-note/reversal ledger rather than silently
    # subtracting from a financial source record.
    constraints = (
        (
            "budget_lines",
            "budget_lines_non_negative_money_check",
            "budgeted_amount >= 0 AND actual_amount >= 0 AND "
            "(planned_quantity IS NULL OR planned_quantity >= 0) AND "
            "(rate_snapshot IS NULL OR rate_snapshot >= 0)",
        ),
        ("vendor_invoices", "vendor_invoices_amount_non_negative_check", "amount >= 0"),
        ("billables", "billables_amount_non_negative_check", "amount >= 0"),
        (
            "client_invoices",
            "client_invoices_financial_totals_check",
            "sequence > 0 AND subtotal_amount >= 0 AND tax_rate_percent >= 0 AND "
            "tax_amount >= 0 AND total_amount >= 0 AND total_amount = subtotal_amount + tax_amount",
        ),
        (
            "client_invoice_items",
            "client_invoice_items_financial_amounts_check",
            "quantity > 0 AND unit_amount >= 0 AND amount >= 0 AND "
            "amount = round(quantity * unit_amount, 2)",
        ),
        (
            "post_work_orders",
            "post_work_orders_non_negative_money_check",
            "(estimated_amount IS NULL OR estimated_amount >= 0) AND "
            "(client_quote_amount IS NULL OR client_quote_amount >= 0) AND "
            "(actual_amount IS NULL OR actual_amount >= 0)",
        ),
        (
            "post_work_order_items",
            "post_work_order_items_non_negative_money_check",
            "quantity >= 0 AND unit_rate >= 0 AND discount_percent >= 0 AND discount_percent <= 100",
        ),
        ("service_rates", "service_rates_rate_non_negative_check", "rate >= 0"),
        ("rate_card_items", "rate_card_items_rate_non_negative_check", "rate >= 0"),
        (
            "people",
            "people_rates_non_negative_check",
            "(hourly_rate IS NULL OR hourly_rate >= 0) AND (day_rate IS NULL OR day_rate >= 0)",
        ),
        (
            "catering_requests",
            "catering_requests_financial_non_negative_check",
            "quantity > 0 AND (actual_cost IS NULL OR actual_cost >= 0) AND "
            "(billed_amount IS NULL OR billed_amount >= 0) AND "
            "(markup_percent IS NULL OR markup_percent >= 0)",
        ),
    )
    for table, name, condition in constraints:
        op.create_check_constraint(name, table, condition)

    # A persistent key converts a browser retry into a replay of the first
    # response. It is scoped to the actor and tenant, so a key can never leak
    # or reserve a financial operation in another post house.
    op.create_table(
        "financial_idempotency_keys",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("actor_user_id", sa.Text(), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(trim(operation)) > 0", name="financial_idempotency_operation_check"),
        sa.CheckConstraint("length(trim(idempotency_key)) BETWEEN 1 AND 255", name="financial_idempotency_key_check"),
        sa.CheckConstraint(
            "(response_status IS NULL AND response_body IS NULL) OR "
            "(response_status BETWEEN 100 AND 599 AND response_body IS NOT NULL)",
            name="financial_idempotency_response_check",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "organization_id",
            "actor_user_id",
            "operation",
            "idempotency_key",
            name="financial_idempotency_actor_operation_key_unique",
        ),
    )
    op.create_index(
        "financial_idempotency_expiry_idx",
        "financial_idempotency_keys",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("financial_idempotency_expiry_idx", table_name="financial_idempotency_keys")
    op.drop_table("financial_idempotency_keys")
    for table, name in reversed(
        (
            ("catering_requests", "catering_requests_financial_non_negative_check"),
            ("people", "people_rates_non_negative_check"),
            ("rate_card_items", "rate_card_items_rate_non_negative_check"),
            ("service_rates", "service_rates_rate_non_negative_check"),
            ("post_work_order_items", "post_work_order_items_non_negative_money_check"),
            ("post_work_orders", "post_work_orders_non_negative_money_check"),
            ("client_invoice_items", "client_invoice_items_financial_amounts_check"),
            ("client_invoices", "client_invoices_financial_totals_check"),
            ("billables", "billables_amount_non_negative_check"),
            ("vendor_invoices", "vendor_invoices_amount_non_negative_check"),
            ("budget_lines", "budget_lines_non_negative_money_check"),
        )
    ):
        op.drop_constraint(name, table, type_="check")
    op.drop_index("purchase_order_allocations_org_vendor_invoice_unique", table_name="purchase_order_allocations")
    op.drop_index("purchase_order_allocations_org_work_order_unique", table_name="purchase_order_allocations")
    op.drop_index("billables_org_source_work_order_unique", table_name="billables")
    op.drop_constraint("billables_source_work_order_id_fkey", "billables", type_="foreignkey")
    op.drop_column("billables", "source_work_order_id")
