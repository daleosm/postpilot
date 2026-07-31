"""Backfill safe planning metadata for existing budget lines.

Revision ID: 20260730_09
Revises: 20260730_08
Create Date: 2026-07-30

Older budget rows stored only their planned total. Keep that total intact,
but give it a transparent fixed-cost planning representation so the estimate
register can explain it without inventing a room, artist, or service link.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260730_09"
down_revision: str | Sequence[str] | None = "20260730_08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # This is deliberately an additive compatibility migration. It neither
    # recalculates monetary values nor upgrades legacy estimates to approved;
    # facilities retain both their historical amount and their review state.
    op.execute(
        """
        UPDATE budget_lines
        SET
          planned_quantity = COALESCE(planned_quantity, 1),
          planned_unit = COALESCE(planned_unit, 'fixed'),
          rate_snapshot = COALESCE(rate_snapshot, budgeted_amount),
          rate_source = COALESCE(NULLIF(rate_source, ''), 'legacy_import'),
          resource_reference = COALESCE(
            NULLIF(resource_reference, ''),
            'legacy_budget_line · Historical planned amount'
          )
        WHERE planned_quantity IS NULL
           OR planned_unit IS NULL
           OR rate_snapshot IS NULL
           OR rate_source IS NULL
           OR resource_reference IS NULL
           OR rate_source = ''
           OR resource_reference = ''
        """
    )


def downgrade() -> None:
    # Values may have been edited after the migration. Leaving their richer
    # planning metadata in place is safer than erasing it during downgrade.
    pass
