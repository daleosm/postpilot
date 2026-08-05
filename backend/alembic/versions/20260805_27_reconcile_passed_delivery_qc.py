"""Reconcile stale delivery QC failures after a passed episode re-QC.

Revision ID: 20260805_27
Revises: 20260805_26
Create Date: 2026-08-05

Older rows could retain ``qc_failed`` delivery-manifest items after the
episode's latest QC report had passed.  A passed re-QC clears only the QC
outcome; dispatch and recipient confirmation remain separate delivery work.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260805_27"
down_revision: str | Sequence[str] | None = "20260805_26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE episode_delivery_items AS item
        SET status = 'qc_passed', qc_result = 'passed', updated_at = NOW()
        FROM episodes AS episode
        WHERE item.episode_id = episode.id
          AND item.organization_id = episode.organization_id
          AND episode.qc_status = 'passed'
          AND item.qc_required = true
          AND item.status = 'qc_failed'
        """
    )
    op.execute(
        """
        UPDATE episode_delivery_items AS item
        SET status = 'preparing', qc_result = 'not_required', updated_at = NOW()
        FROM episodes AS episode
        WHERE item.episode_id = episode.id
          AND item.organization_id = episode.organization_id
          AND episode.qc_status = 'passed'
          AND item.qc_required = false
          AND item.status = 'qc_failed'
        """
    )


def downgrade() -> None:
    # Do not recreate old failure states from a successful re-QC.
    pass
