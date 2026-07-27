"""Add tenant-safe Microsoft Entra SSO connection and identity foundations.

Revision ID: 20260727_04
Revises: 20260726_03
Create Date: 2026-07-27

SSO configuration belongs to an organization, while an external identity is
linked to a global PostPilot user.  This preserves the existing membership
model: logging in through Microsoft never creates tenant access by itself.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260727_04"
down_revision: str | Sequence[str] | None = "20260726_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sso_connections",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False, server_default=sa.text("'microsoft_entra'")),
        sa.Column("entra_tenant_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("allowed_email_domains", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("provider = 'microsoft_entra'", name="sso_connections_provider_check"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name="sso_connections_organization_id_organizations_id_fk",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("organization_id", "provider", name="sso_connections_organization_provider_unique"),
    )
    op.create_index(
        "sso_connections_tenant_lookup_idx",
        "sso_connections",
        ["organization_id", "enabled"],
    )
    op.create_index(
        "sso_connections_entra_tenant_lookup_idx",
        "sso_connections",
        ["provider", "entra_tenant_id"],
    )

    op.create_table(
        "external_identities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False, server_default=sa.text("'microsoft_entra'")),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("entra_tenant_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("entra_object_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("verified_email", sa.Text(), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("provider = 'microsoft_entra'", name="external_identities_provider_check"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="external_identities_user_id_users_id_fk",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("provider", "issuer", "subject", name="external_identities_provider_issuer_subject_unique"),
        sa.UniqueConstraint(
            "provider",
            "entra_tenant_id",
            "entra_object_id",
            name="external_identities_provider_entra_object_unique",
        ),
    )
    op.create_index("external_identities_user_lookup_idx", "external_identities", ["user_id"])
    op.create_index(
        "external_identities_entra_tenant_lookup_idx",
        "external_identities",
        ["provider", "entra_tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("external_identities_entra_tenant_lookup_idx", table_name="external_identities")
    op.drop_index("external_identities_user_lookup_idx", table_name="external_identities")
    op.drop_table("external_identities")
    op.drop_index("sso_connections_entra_tenant_lookup_idx", table_name="sso_connections")
    op.drop_index("sso_connections_tenant_lookup_idx", table_name="sso_connections")
    op.drop_table("sso_connections")
