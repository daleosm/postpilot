"""Backfill rate-role links where an existing service name matches a role label.

Revision ID: 20260805_24
Revises: 20260805_23
Create Date: 2026-08-05

This is intentionally conservative: it only links an existing rate when its
name unambiguously normalises to a tenant's configured role label. Every other
legacy row stays a generic service until an authorised user maps it in the UI.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260805_24"
down_revision: str | Sequence[str] | None = "20260805_23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE service_rates AS service
        SET artist_role = policy.role
        FROM organization_role_policies AS policy
        WHERE service.organization_id = policy.organization_id
          AND service.artist_role IS NULL
          AND regexp_replace(lower(service.name), '[^a-z0-9]+', '', 'g')
              = regexp_replace(lower(policy.label), '[^a-z0-9]+', '', 'g')
        """
    )
    op.execute(
        """
        UPDATE rate_card_items AS item
        SET artist_role = service.artist_role
        FROM service_rates AS service
        WHERE item.service_rate_id = service.id
          AND item.organization_id = service.organization_id
          AND item.target_type = 'service'
          AND item.artist_role IS NULL
          AND service.artist_role IS NOT NULL
        """
    )


def downgrade() -> None:
    # Existing rows may have been deliberately mapped before this migration;
    # never erase those decisions on downgrade.
    pass
