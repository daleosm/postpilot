"""Convert facility service and inherited rate-card prices to hourly units.

Revision ID: 20260731_12
Revises: 20260731_11
Create Date: 2026-07-31

Budget-line snapshots remain untouched: they are historical approved
estimates. Only live catalogue and inherited card entries are converted, using
the facility's documented nine-hour operating day.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260731_12"
down_revision: str | Sequence[str] | None = "20260731_11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FACILITY_DAY_HOURS = 9


def upgrade() -> None:
    # Rates have two decimal-place commercial precision. A converted hourly
    # value is therefore the closest valid rate; existing locked estimates are
    # intentionally preserved rather than silently recomputed.
    op.execute(
        f"""
        UPDATE service_rates
        SET unit = 'hour', rate = round(rate / {FACILITY_DAY_HOURS}::numeric, 2)
        WHERE unit = 'day'
        """
    )
    op.execute(
        f"""
        UPDATE rate_card_items
        SET unit = 'hour', rate = round(rate / {FACILITY_DAY_HOURS}::numeric, 2)
        WHERE unit = 'day'
        """
    )


def downgrade() -> None:
    # The migration cannot distinguish a converted rate from a rate that was
    # already hourly, nor can it restore a two-decimal daily value exactly.
    # Refuse a destructive automatic rollback rather than corrupting prices.
    raise NotImplementedError("Hourly service-rate conversion is irreversible; restore from backup if required.")
