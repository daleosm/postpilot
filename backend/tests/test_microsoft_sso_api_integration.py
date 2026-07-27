from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_production_api_integration import ProductionApiLab

from app.auth import resolve_microsoft_user
from app.config import get_settings
from app.microsoft_sso import MicrosoftAccessToken

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Microsoft SSO API integration tests run in CI against migrated PostgreSQL.",
)


@dataclass
class _Validator:
    identity: MicrosoftAccessToken

    async def validate_access_token(self, token: str) -> MicrosoftAccessToken:
        assert token == "signed-entra-api-token"
        return self.identity


def _configure_sso(monkeypatch: pytest.MonkeyPatch, tenant_id: str) -> None:
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_ENABLED", "true")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_SPA_CLIENT_ID", "postpilot-spa-client-id")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_API_AUDIENCE", "postpilot-api-client-id")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_ALLOWED_TENANT_IDS", tenant_id)
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_REQUIRED_SCOPE", "access_as_user")
    get_settings.cache_clear()


def _identity(
    email: str,
    tenant_id: str,
    *,
    subject: str | None = None,
    object_id: str | None = None,
    issuer: str | None = None,
) -> MicrosoftAccessToken:
    return MicrosoftAccessToken(
        issuer=issuer or f"https://login.microsoftonline.com/{tenant_id}/v2.0",
        tenant_id=tenant_id,
        subject=subject or f"subject-{uuid4()}",
        object_id=object_id or str(uuid4()),
        verified_email=email,
    )


def _sqlalchemy_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return "postgresql+asyncpg://" + database_url.removeprefix("postgres://")
    if database_url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + database_url.removeprefix("postgresql://")
    return database_url


def test_exchange_links_an_existing_member_and_issues_only_an_opaque_session(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["authenticated_user_id"] == production_lab.data.manager_user_id
    assert response.json()["active_organization_id"] == production_lab.data.organization_id
    assert production_lab.client.cookies.get("postpilot_session")
    assert (
        production_lab.fetchval(
            "SELECT user_id FROM external_identities WHERE provider = 'microsoft_entra' AND subject = $1",
            identity.subject,
        )
        == production_lab.data.manager_user_id
    )
    assert production_lab.fetchval(
        "SELECT count(*) FROM api_sessions WHERE user_id = $1",
        production_lab.data.manager_user_id,
    )


def test_exchange_never_creates_accounts_or_bypasses_an_enabled_tenant_connection(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    identity = _identity(f"unknown-{uuid4().hex}@postpilot.test", tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    unknown_user = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )
    missing_header = production_lab.client.post("/v1/auth/microsoft/exchange")

    assert unknown_user.status_code == 403
    assert unknown_user.json()["detail"] == "No matching PostPilot account."
    assert missing_header.status_code == 401
    assert production_lab.fetchval("SELECT count(*) FROM external_identities WHERE subject = $1", identity.subject) == 0


def test_exchange_requires_a_matching_enabled_sso_connection_for_an_existing_user(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Microsoft sign-in is not enabled for this PostPilot membership."
    assert production_lab.fetchval("SELECT count(*) FROM external_identities WHERE subject = $1", identity.subject) == 0


def test_exchange_rejects_an_ambiguous_work_email_before_linking(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    production_lab.execute(
        "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)",
        f"sso-duplicate-{uuid4()}",
        "Duplicate work email",
        production_lab.data.manager_email.upper(),
        "not-used-by-sso",
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Microsoft work email matches multiple PostPilot accounts."
    assert production_lab.fetchval("SELECT count(*) FROM external_identities WHERE subject = $1", identity.subject) == 0


def test_exchange_rejects_a_matching_user_without_any_tenant_membership(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    email = f"unaffiliated-{uuid4().hex}@postpilot.test"
    production_lab.execute(
        "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)",
        f"sso-unaffiliated-{uuid4()}",
        "Unaffiliated account",
        email,
        "not-used-by-sso",
    )
    identity = _identity(email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Microsoft sign-in is not enabled for this PostPilot membership."
    assert production_lab.fetchval("SELECT count(*) FROM external_identities WHERE subject = $1", identity.subject) == 0


def test_sso_settings_are_tenant_scoped_and_only_settings_users_can_toggle(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = str(uuid4())
    foreign_tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    identity = _identity(production_lab.data.manager_email, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true), ($3, 'microsoft_entra', $4, true)",
        production_lab.data.organization_id,
        tenant_id,
        production_lab.data.foreign_organization_id,
        foreign_tenant_id,
    )
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        identity.issuer,
        identity.tenant_id,
        identity.object_id,
        identity.subject,
        identity.verified_email,
    )
    production_lab.sign_in_as_manager()

    settings = production_lab.client.get("/v1/settings/sso")

    assert settings.status_code == 200, settings.text
    body = settings.json()
    assert body["runtime_enabled"] is True
    assert body["connection"]["entra_tenant_id"] == tenant_id
    assert body["linked_user_count"] == 1
    assert (
        next(user for user in body["users"] if user["user_id"] == production_lab.data.manager_user_id)[
            "microsoft_linked"
        ]
        is True
    )
    assert (
        production_lab.client.patch(
            "/v1/settings/sso/connection", json={"enabled": False, "entra_tenant_id": foreign_tenant_id}
        ).status_code
        == 422
    )
    disabled = production_lab.client.patch("/v1/settings/sso/connection", json={"enabled": False})
    assert disabled.status_code == 200
    assert disabled.json() == {"enabled": False}
    assert (
        production_lab.fetchval(
            "SELECT action FROM activity_log WHERE organization_id = $1 AND entity_type = 'sso_connection' "
            "ORDER BY created_at DESC LIMIT 1",
            production_lab.data.organization_id,
        )
        == "sso.connection_disabled"
    )
    assert (
        production_lab.fetchval(
            "SELECT enabled FROM sso_connections WHERE organization_id = $1",
            production_lab.data.foreign_organization_id,
        )
        is True
    )

    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/settings/sso").status_code == 403
    assert production_lab.client.patch("/v1/settings/sso/connection", json={"enabled": True}).status_code == 403


def test_signed_in_user_can_disconnect_only_own_microsoft_link_with_password_fallback(
    production_lab: ProductionApiLab,
) -> None:
    tenant_id = str(uuid4())
    identity = _identity(production_lab.data.manager_email, tenant_id)
    second_identity = _identity(production_lab.data.manager_email, str(uuid4()))
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        identity.issuer,
        identity.tenant_id,
        identity.object_id,
        identity.subject,
        identity.verified_email,
    )
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        second_identity.issuer,
        second_identity.tenant_id,
        second_identity.object_id,
        second_identity.subject,
        second_identity.verified_email,
    )
    production_lab.sign_in_as_manager()

    status_response = production_lab.client.get("/v1/auth/microsoft/link")
    assert status_response.status_code == 200
    assert status_response.json()["linked"] is True
    assert status_response.json()["linked_identity_count"] == 2
    assert status_response.json()["local_password_available"] is True
    disconnected = production_lab.client.delete("/v1/auth/microsoft/link")
    assert disconnected.status_code == 200
    assert disconnected.json() == {"linked": False}
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM external_identities WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == 0
    )


def test_microsoft_disconnect_requires_a_local_password_fallback(production_lab: ProductionApiLab) -> None:
    tenant_id = str(uuid4())
    identity = _identity(production_lab.data.manager_email, tenant_id)
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        identity.issuer,
        identity.tenant_id,
        identity.object_id,
        identity.subject,
        identity.verified_email,
    )
    production_lab.sign_in_as_manager()
    production_lab.execute("UPDATE users SET password_hash = NULL WHERE id = $1", production_lab.data.manager_user_id)

    response = production_lab.client.delete("/v1/auth/microsoft/link")

    assert response.status_code == 409
    assert response.json()["detail"] == "Set a local password before disconnecting Microsoft sign-in."
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM external_identities WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == 1
    )


def test_microsoft_disconnect_reports_missing_link_without_affecting_password_session(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()

    response = production_lab.client.delete("/v1/auth/microsoft/link")

    assert response.status_code == 404
    assert response.json()["detail"] == "Microsoft sign-in is not linked to this account."
    assert production_lab.client.get("/v1/auth/session").status_code == 200


def test_sso_connection_toggle_requires_runtime_configuration_and_an_existing_tenant_connection(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    production_lab.sign_in_as_manager()
    missing = production_lab.client.patch("/v1/settings/sso/connection", json={"enabled": False})
    assert missing.status_code == 404

    tenant_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, false)",
        production_lab.data.organization_id,
        tenant_id,
    )
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_ENABLED", "false")
    get_settings.cache_clear()
    disabled_runtime = production_lab.client.patch("/v1/settings/sso/connection", json={"enabled": True})

    assert disabled_runtime.status_code == 409
    assert disabled_runtime.json()["detail"] == "Microsoft SSO is not enabled in this deployment."


def test_exchange_cannot_reuse_an_immutable_entra_object_for_another_postpilot_user(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An Entra object must never be moved to the user matching a new email."""
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    original = _identity(production_lab.data.manager_email, tenant_id)
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        original.issuer,
        original.tenant_id,
        original.object_id,
        original.subject,
        original.verified_email,
    )
    # A changed subject plus the viewer's email must not transfer the object
    # to the viewer. The immutable tenant/object tuple is the authority.
    attempted_reuse = _identity(
        production_lab.data.viewer_email,
        tenant_id,
        subject=f"replacement-subject-{uuid4()}",
        object_id=original.object_id,
    )
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(attempted_reuse))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Microsoft identity is linked to another account."
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM external_identities WHERE entra_object_id = $1", original.object_id
        )
        == 1
    )
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM api_sessions WHERE user_id IN ($1, $2)",
            production_lab.data.manager_user_id,
            production_lab.data.viewer_user_id,
        )
        == 0
    )


def test_exchange_does_not_restore_removed_memberships_or_apply_foreign_tenant_access(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A valid identity is not tenant authority: live membership is required."""
    from app.api.routes import auth as auth_route

    local_tenant_id = str(uuid4())
    foreign_tenant_id = str(uuid4())
    _configure_sso(monkeypatch, f"{local_tenant_id},{foreign_tenant_id}")
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true), ($3, 'microsoft_entra', $4, true)",
        production_lab.data.organization_id,
        local_tenant_id,
        production_lab.data.foreign_organization_id,
        foreign_tenant_id,
    )
    linked_identity = _identity(production_lab.data.manager_email, local_tenant_id)
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        linked_identity.issuer,
        linked_identity.tenant_id,
        linked_identity.object_id,
        linked_identity.subject,
        linked_identity.verified_email,
    )
    production_lab.execute(
        "DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.manager_user_id,
    )
    # The manager is not a member of the foreign organization either. A
    # foreign connection must not be selected simply because it is enabled.
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(linked_identity))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Microsoft sign-in is not enabled for this PostPilot membership."
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM organization_members WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == 0
    )
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM api_sessions WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == 0
    )


def test_exchange_does_not_change_existing_postpilot_membership_roles_or_capabilities(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))
    before_membership_role = production_lab.fetchval(
        "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.manager_user_id,
    )
    before_person_role = production_lab.fetchval(
        "SELECT role FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.manager_user_id,
    )

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange",
        headers={"Authorization": "Bearer signed-entra-api-token"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["authenticated_user_id"] == production_lab.data.manager_user_id
    assert body["permissions"] == [
        "do_assigned_work",
        "manage_commercial",
        "manage_production",
        "manage_qc_delivery",
        "manage_settings",
        "sign_off_work",
        "view_all_operations",
    ]
    assert (
        production_lab.fetchval(
            "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2",
            production_lab.data.organization_id,
            production_lab.data.manager_user_id,
        )
        == before_membership_role
    )
    assert (
        production_lab.fetchval(
            "SELECT role FROM people WHERE organization_id = $1 AND user_id = $2",
            production_lab.data.organization_id,
            production_lab.data.manager_user_id,
        )
        == before_person_role
    )


def test_exchange_enforces_configured_work_email_domains_before_and_after_linking(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        """
        INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled, allowed_email_domains)
        VALUES ($1, 'microsoft_entra', $2, true, ARRAY['@POSTPILOT.TEST'])
        """,
        production_lab.data.organization_id,
        tenant_id,
    )
    allowed_identity = _identity(production_lab.data.manager_email.upper(), tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(allowed_identity))
    assert (
        production_lab.client.post(
            "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
        ).status_code
        == 200
    )

    wrong_domain_identity = _identity(
        "renamed@outside.example",
        tenant_id,
        subject=allowed_identity.subject,
        object_id=allowed_identity.object_id,
        issuer=allowed_identity.issuer,
    )
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(wrong_domain_identity))
    rejected = production_lab.client.post(
        "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
    )

    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "Microsoft sign-in is not enabled for this PostPilot membership."
    assert (
        production_lab.fetchval(
            "SELECT verified_email FROM external_identities WHERE provider = 'microsoft_entra' AND subject = $1",
            allowed_identity.subject,
        )
        == allowed_identity.verified_email
    )


def test_sso_exchange_uses_a_fresh_opaque_session_and_preserves_identity_on_local_sign_out(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    monkeypatch.setenv("POSTPILOT_COOKIE_SECURE", "true")
    get_settings.cache_clear()
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    exchange = production_lab.client.post(
        "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
    )

    assert exchange.status_code == 200, exchange.text
    cookie = exchange.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "secure" in cookie
    assert "signed-entra-api-token" not in exchange.text
    assert (
        production_lab.fetchval(
            "SELECT impersonated_user_id FROM api_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            production_lab.data.manager_user_id,
        )
        is None
    )
    # A Secure cookie is intentionally not sent back over this HTTP TestClient
    # transport. Re-enable the local test transport before exercising the
    # opaque-session revocation endpoint itself.
    token = production_lab.client.cookies.get("postpilot_session")
    assert token
    monkeypatch.setenv("POSTPILOT_COOKIE_SECURE", "false")
    get_settings.cache_clear()
    production_lab.client.cookies.set("postpilot_session", token)
    production_lab.sign_out()
    assert production_lab.client.get("/v1/auth/session").status_code == 401
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM external_identities WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == 1
    )


def test_sso_session_uses_the_same_live_tenant_context_and_membership_fallback(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    production_lab.execute(
        "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')",
        production_lab.data.foreign_organization_id,
        production_lab.data.manager_user_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))
    assert (
        production_lab.client.post(
            "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
        ).status_code
        == 200
    )
    assert (
        production_lab.client.post(
            "/v1/organizations/active",
            json={"organization_id": production_lab.data.foreign_organization_id, "pathname": "/shows"},
        ).json()["active_organization_id"]
        == production_lab.data.foreign_organization_id
    )
    production_lab.execute(
        "DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.foreign_organization_id,
        production_lab.data.manager_user_id,
    )
    session = production_lab.client.get("/v1/auth/session")

    assert session.status_code == 200
    assert session.json()["active_organization_id"] == production_lab.data.organization_id


def test_sso_selects_a_deterministic_matching_membership_without_granting_extra_access(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')",
        production_lab.data.foreign_organization_id,
        production_lab.data.manager_user_id,
    )
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true), ($3, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
        production_lab.data.foreign_organization_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))

    response = production_lab.client.post(
        "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["active_organization_id"] == min(
        production_lab.data.organization_id, production_lab.data.foreign_organization_id
    )
    assert {membership["organization_id"] for membership in response.json()["memberships"]} == {
        production_lab.data.organization_id,
        production_lab.data.foreign_organization_id,
    }


def test_disconnect_then_relink_requires_the_same_existing_member_and_never_recreates_membership(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import auth as auth_route

    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)
    monkeypatch.setattr(auth_route, "get_microsoft_token_validator", lambda: _Validator(identity))
    assert (
        production_lab.client.post(
            "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
        ).status_code
        == 200
    )
    before_memberships = production_lab.fetchval(
        "SELECT count(*) FROM organization_members WHERE user_id = $1", production_lab.data.manager_user_id
    )
    assert production_lab.client.delete("/v1/auth/microsoft/link").status_code == 200

    relinked = production_lab.client.post(
        "/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer signed-entra-api-token"}
    )

    assert relinked.status_code == 200
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM external_identities WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == 1
    )
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM organization_members WHERE user_id = $1", production_lab.data.manager_user_id
        )
        == before_memberships
    )


def test_parallel_first_microsoft_links_create_only_one_identity_record(
    production_lab: ProductionApiLab, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = str(uuid4())
    _configure_sso(monkeypatch, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    identity = _identity(production_lab.data.manager_email, tenant_id)

    async def resolve_once(factory) -> tuple[str, str]:
        async with factory() as session:
            return await resolve_microsoft_user(session, identity)

    async def exercise() -> list[tuple[str, str]]:
        engine = create_async_engine(_sqlalchemy_url(production_lab.database_url), pool_pre_ping=True)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            return await asyncio.gather(resolve_once(factory), resolve_once(factory))
        finally:
            await engine.dispose()

    results = asyncio.run(exercise())

    assert results == [
        (production_lab.data.manager_user_id, production_lab.data.organization_id),
        (production_lab.data.manager_user_id, production_lab.data.organization_id),
    ]
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM external_identities WHERE provider = 'microsoft_entra' AND subject = $1",
            identity.subject,
        )
        == 1
    )


def test_database_rejects_duplicate_sso_connection_and_immutable_identity_values(
    production_lab: ProductionApiLab,
) -> None:
    tenant_id = str(uuid4())
    identity = _identity(production_lab.data.manager_email, tenant_id)
    production_lab.execute(
        "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
        "VALUES ($1, 'microsoft_entra', $2, true)",
        production_lab.data.organization_id,
        tenant_id,
    )
    production_lab.execute(
        """
        INSERT INTO external_identities
          (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
        VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
        """,
        production_lab.data.manager_user_id,
        identity.issuer,
        identity.tenant_id,
        identity.object_id,
        identity.subject,
        identity.verified_email,
    )

    with pytest.raises(asyncpg.UniqueViolationError):
        production_lab.execute(
            "INSERT INTO sso_connections (organization_id, provider, entra_tenant_id, enabled) "
            "VALUES ($1, 'microsoft_entra', $2, true)",
            production_lab.data.organization_id,
            str(uuid4()),
        )
    with pytest.raises(asyncpg.UniqueViolationError):
        production_lab.execute(
            """
            INSERT INTO external_identities
              (user_id, provider, issuer, entra_tenant_id, entra_object_id, subject, verified_email)
            VALUES ($1, 'microsoft_entra', $2, $3, $4, $5, $6)
            """,
            production_lab.data.viewer_user_id,
            identity.issuer,
            identity.tenant_id,
            identity.object_id,
            f"other-subject-{uuid4()}",
            production_lab.data.viewer_email,
        )
