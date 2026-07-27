from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint

from app.db.tables import external_identities, sso_connections


def _unique_column_sets(table) -> set[tuple[str, ...]]:
    return {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }


def _foreign_key_targets(table) -> set[str]:
    return {
        element.target_fullname
        for constraint in table.constraints
        if isinstance(constraint, ForeignKeyConstraint)
        for element in constraint.elements
    }


def test_sso_connections_are_scoped_to_one_organization() -> None:
    assert {
        "id",
        "organization_id",
        "provider",
        "entra_tenant_id",
        "enabled",
        "allowed_email_domains",
        "created_at",
        "updated_at",
    } <= set(sso_connections.c.keys())
    assert "organizations.id" in _foreign_key_targets(sso_connections)
    assert ("organization_id", "provider") in _unique_column_sets(sso_connections)
    assert any(
        isinstance(constraint, CheckConstraint) and "microsoft_entra" in str(constraint.sqltext)
        for constraint in sso_connections.constraints
    )


def test_external_identities_link_global_users_by_immutable_provider_identity() -> None:
    assert {
        "id",
        "user_id",
        "provider",
        "issuer",
        "entra_tenant_id",
        "entra_object_id",
        "subject",
        "verified_email",
        "linked_at",
        "last_used_at",
    } <= set(external_identities.c.keys())
    assert "users.id" in _foreign_key_targets(external_identities)
    assert ("provider", "issuer", "subject") in _unique_column_sets(external_identities)
    assert ("provider", "entra_tenant_id", "entra_object_id") in _unique_column_sets(external_identities)
