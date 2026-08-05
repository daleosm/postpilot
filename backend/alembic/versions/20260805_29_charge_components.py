"""Add commercial treatments to booking components and work-order ledgers.

Revision ID: 20260805_29
Revises: 20260805_28
Create Date: 2026-08-05

The existing booking component table remains the compatibility ledger for
itemised booking invoices. This migration broadens it so a fixed fee can sit
beside scheduled resources, and adds an equivalent tenant-scoped work-order
ledger. No historic prices are guessed or backfilled.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260805_29"
down_revision: str | Sequence[str] | None = "20260805_28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COMPONENT_TYPES = "component_type IN ('room', 'person', 'service', 'overtime', 'fixed_fee')"
_BILLING_TREATMENTS = "billing_treatment IN ('billable', 'included', 'internal_no_charge')"
_TAX_TREATMENTS = "tax_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')"


def upgrade() -> None:
    op.add_column(
        "booking_charge_components",
        sa.Column("billing_treatment", sa.Text(), nullable=False, server_default="billable"),
    )
    op.add_column(
        "booking_charge_components",
        sa.Column("tax_treatment", sa.Text(), nullable=False, server_default="standard"),
    )
    op.drop_constraint("booking_charge_components_type_check", "booking_charge_components", type_="check")
    op.drop_constraint("booking_charge_components_resource_check", "booking_charge_components", type_="check")
    op.drop_constraint("booking_charge_components_booking_type_unique", "booking_charge_components", type_="unique")
    op.create_check_constraint("booking_charge_components_type_check", "booking_charge_components", _COMPONENT_TYPES)
    op.create_check_constraint(
        "booking_charge_components_billing_treatment_check", "booking_charge_components", _BILLING_TREATMENTS
    )
    op.create_check_constraint(
        "booking_charge_components_tax_treatment_check", "booking_charge_components", _TAX_TREATMENTS
    )
    op.create_check_constraint(
        "booking_charge_components_resource_check",
        "booking_charge_components",
        "(component_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL) "
        "OR (component_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL) "
        "OR (component_type IN ('service', 'overtime', 'fixed_fee') AND room_id IS NULL AND person_id IS NULL)",
    )
    op.create_unique_constraint(
        "booking_charge_components_booking_type_unique",
        "booking_charge_components",
        ["booking_id", "component_type", "resource_name"],
    )
    # Keep these compatibility defaults for historic/imported booking rows.
    # New application writes still set the treatment explicitly.

    op.create_table(
        "work_order_charge_components",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "work_order_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("post_work_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "work_order_item_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("post_work_order_items.id", ondelete="SET NULL"),
        ),
        sa.Column("component_type", sa.Text(), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("rooms.id", ondelete="SET NULL")),
        sa.Column("person_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("people.id", ondelete="SET NULL")),
        sa.Column("resource_name", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("billing_unit", sa.Text(), nullable=False),
        sa.Column("client_rate", sa.Numeric(14, 2), nullable=False),
        sa.Column("internal_cost_rate", sa.Numeric(14, 2)),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("rate_source", sa.Text(), nullable=False),
        sa.Column("rate_card_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("rate_cards.id", ondelete="SET NULL")),
        sa.Column(
            "rate_card_item_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("rate_card_items.id", ondelete="SET NULL"),
        ),
        sa.Column("billing_treatment", sa.Text(), nullable=False),
        sa.Column("tax_treatment", sa.Text(), nullable=False),
        sa.Column("override_reason", sa.Text()),
        sa.Column("estimated_quantity", sa.Numeric(14, 6), nullable=False),
        sa.Column("estimated_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("actual_quantity", sa.Numeric(14, 6)),
        sa.Column("actual_client_amount", sa.Numeric(14, 2)),
        sa.Column("actual_internal_amount", sa.Numeric(14, 2)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(_COMPONENT_TYPES, name="work_order_charge_components_type_check"),
        sa.CheckConstraint(_BILLING_TREATMENTS, name="work_order_charge_components_billing_treatment_check"),
        sa.CheckConstraint(_TAX_TREATMENTS, name="work_order_charge_components_tax_treatment_check"),
        sa.CheckConstraint("client_rate >= 0", name="work_order_charge_components_client_rate_non_negative_check"),
        sa.CheckConstraint(
            "internal_cost_rate IS NULL OR internal_cost_rate >= 0",
            name="work_order_charge_components_internal_rate_non_negative_check",
        ),
        sa.CheckConstraint("estimated_quantity >= 0", name="work_order_charge_components_quantity_non_negative_check"),
        sa.CheckConstraint("estimated_amount >= 0", name="work_order_charge_components_amount_non_negative_check"),
        sa.CheckConstraint(
            "actual_quantity IS NULL OR actual_quantity >= 0",
            name="work_order_charge_components_actual_quantity_non_negative_check",
        ),
        sa.CheckConstraint(
            "actual_client_amount IS NULL OR actual_client_amount >= 0",
            name="work_order_charge_components_actual_client_non_negative_check",
        ),
        sa.CheckConstraint(
            "actual_internal_amount IS NULL OR actual_internal_amount >= 0",
            name="work_order_charge_components_actual_internal_non_negative_check",
        ),
        sa.CheckConstraint(
            "(component_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL) "
            "OR (component_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL) "
            "OR (component_type IN ('service', 'overtime', 'fixed_fee') AND room_id IS NULL AND person_id IS NULL)",
            name="work_order_charge_components_resource_check",
        ),
        sa.UniqueConstraint(
            "work_order_id",
            "component_type",
            "resource_name",
            name="work_order_charge_components_work_order_type_unique",
        ),
    )
    op.create_index(
        "work_order_charge_components_organization_work_order_idx",
        "work_order_charge_components",
        ["organization_id", "work_order_id"],
    )


def downgrade() -> None:
    op.drop_index("work_order_charge_components_organization_work_order_idx", table_name="work_order_charge_components")
    op.drop_table("work_order_charge_components")
    op.drop_constraint("booking_charge_components_resource_check", "booking_charge_components", type_="check")
    op.drop_constraint("booking_charge_components_tax_treatment_check", "booking_charge_components", type_="check")
    op.drop_constraint("booking_charge_components_billing_treatment_check", "booking_charge_components", type_="check")
    op.drop_constraint("booking_charge_components_type_check", "booking_charge_components", type_="check")
    op.drop_constraint("booking_charge_components_booking_type_unique", "booking_charge_components", type_="unique")
    op.create_check_constraint(
        "booking_charge_components_type_check", "booking_charge_components", "component_type IN ('room', 'person')"
    )
    op.create_check_constraint(
        "booking_charge_components_resource_check",
        "booking_charge_components",
        "(component_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL) "
        "OR (component_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL)",
    )
    op.create_unique_constraint(
        "booking_charge_components_booking_type_unique", "booking_charge_components", ["booking_id", "component_type"]
    )
    op.drop_column("booking_charge_components", "tax_treatment")
    op.drop_column("booking_charge_components", "billing_treatment")
