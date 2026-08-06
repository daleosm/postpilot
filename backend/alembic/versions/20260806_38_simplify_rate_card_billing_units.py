"""Limit active rate cards to hourly, day, and fixed-fee pricing.

Revision ID: 20260806_38
Revises: 20260806_37
Create Date: 2026-08-06

Rate-card rows are configurable prices, not financial history.  Remove the
obsolete configuration rows rather than guessing whether a half-day, week,
per-episode, or counted-unit price should become a day or fixed-fee price.
Confirmed booking and invoice snapshots retain their saved amounts and remain
fully auditable.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260806_38"
down_revision: str | Sequence[str] | None = "20260806_37"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SUPPORTED_BILLING_UNITS = "unit IN ('hour', 'day', 'fixed')"
_LEGACY_BILLING_UNITS = "unit NOT IN ('hour', 'day', 'fixed')"


def upgrade() -> None:
    op.drop_constraint("rate_card_items_billing_unit_check", "rate_card_items", type_="check")
    op.drop_constraint("service_rates_billing_unit_check", "service_rates", type_="check")

    # These are future pricing rules only.  Financial source snapshots use
    # independent saved values, and foreign keys deliberately SET NULL.
    op.execute(f"DELETE FROM rate_card_items WHERE {_LEGACY_BILLING_UNITS}")
    op.execute(f"DELETE FROM service_rates WHERE {_LEGACY_BILLING_UNITS}")

    op.create_check_constraint("service_rates_billing_unit_check", "service_rates", _SUPPORTED_BILLING_UNITS)
    op.create_check_constraint("rate_card_items_billing_unit_check", "rate_card_items", _SUPPORTED_BILLING_UNITS)


def downgrade() -> None:
    op.drop_constraint("rate_card_items_billing_unit_check", "rate_card_items", type_="check")
    op.drop_constraint("service_rates_billing_unit_check", "service_rates", type_="check")
    op.create_check_constraint(
        "service_rates_billing_unit_check",
        "service_rates",
        "unit IN ('hour', 'half_day', 'day', 'week', 'episode', 'fixed', 'unit')",
    )
    op.create_check_constraint(
        "rate_card_items_billing_unit_check",
        "rate_card_items",
        "unit IN ('hour', 'half_day', 'day', 'week', 'episode', 'fixed', 'unit')",
    )
