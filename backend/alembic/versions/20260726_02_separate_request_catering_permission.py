"""Make catering requests an explicit tenant capability.

Revision ID: 20260726_02
Revises: 20260724_01
Create Date: 2026-07-26
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260726_02"
down_revision: str | Sequence[str] | None = "20260724_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Before this revision, request_catering was an alias for
    # do_assigned_work. Preserve the access existing tenant policies had, but
    # make it independently removable in the role-policy editor.
    op.execute(
        """
        UPDATE organization_role_policies
        SET permissions = permissions::jsonb || '["request_catering"]'::jsonb
        WHERE permissions::jsonb ? 'do_assigned_work'
          AND NOT permissions::jsonb ? 'request_catering'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE organization_role_policies
        SET permissions = (
            SELECT COALESCE(jsonb_agg(permission), '[]'::jsonb)
            FROM jsonb_array_elements_text(permissions::jsonb) AS permission
            WHERE permission <> 'request_catering'
        )
        WHERE permissions::jsonb ? 'request_catering'
        """
    )
