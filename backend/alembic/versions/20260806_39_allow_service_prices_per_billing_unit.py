"""Allow one catalogue service to carry the three supported price units.

Revision ID: 20260806_39
Revises: 20260806_38
Create Date: 2026-08-06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260806_39"
down_revision: str | Sequence[str] | None = "20260806_38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("service_rates_organization_name_idx", table_name="service_rates")
    op.create_index(
        "service_rates_organization_name_unit_idx",
        "service_rates",
        ["organization_id", "name", "unit"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("service_rates_organization_name_unit_idx", table_name="service_rates")
    op.create_index(
        "service_rates_organization_name_idx",
        "service_rates",
        ["organization_id", "name"],
        unique=True,
    )
