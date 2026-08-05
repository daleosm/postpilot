"""Constrain rate cards to the supported commercial billing units.

Revision ID: 20260805_30
Revises: 20260805_29
Create Date: 2026-08-05

Historic per-episode rows remain valid.  The constraint adds the operational
units available to new service, room, and named-artist rates without guessing
or rewriting any saved commercial data.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260805_30"
down_revision: str | Sequence[str] | None = "20260805_29"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BILLING_UNITS = "unit IN ('hour', 'half_day', 'day', 'week', 'episode', 'fixed', 'unit')"


def upgrade() -> None:
    op.create_check_constraint("service_rates_billing_unit_check", "service_rates", _BILLING_UNITS)
    op.create_check_constraint("rate_card_items_billing_unit_check", "rate_card_items", _BILLING_UNITS)


def downgrade() -> None:
    op.drop_constraint("rate_card_items_billing_unit_check", "rate_card_items", type_="check")
    op.drop_constraint("service_rates_billing_unit_check", "service_rates", type_="check")
