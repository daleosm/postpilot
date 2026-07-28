"""Static and settings contracts for the FastAPI runtime deployment."""

from pathlib import Path

from app.config import Settings

ROOT = Path(__file__).resolve().parents[2]


def test_fastapi_runtime_uses_the_native_postpilot_configuration_names(monkeypatch) -> None:
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", "postgresql://postpilot:postpilot@localhost:5432/postpilot")
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "a-long-enough-fastapi-session-secret-value")
    monkeypatch.setenv("POSTPILOT_FRONTEND_ORIGINS", "https://demo.example.test,https://admin.example.test")

    settings = Settings(_env_file=None)

    assert settings.database_url.startswith("postgresql://")
    assert settings.session_secret == "a-long-enough-fastapi-session-secret-value"
    assert settings.frontend_origins == ["https://demo.example.test", "https://admin.example.test"]


def test_fastapi_accepts_the_legacy_local_secret_names_during_rollout(monkeypatch) -> None:
    # The test asserts alias fallback, so remove any higher-precedence native
    # values inherited from the shell that is running the integration suite.
    monkeypatch.delenv("POSTPILOT_DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTPILOT_SESSION_SECRET", raising=False)
    monkeypatch.delenv("POSTPILOT_FRONTEND_ORIGINS", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://postpilot:postpilot@localhost:5432/postpilot")
    monkeypatch.setenv("NEXTAUTH_SECRET", "a-long-enough-legacy-session-secret-value")
    monkeypatch.setenv("NEXTAUTH_URL", "https://existing-demo.example.test")

    settings = Settings(_env_file=None)

    assert settings.session_secret == "a-long-enough-legacy-session-secret-value"
    assert settings.frontend_origins == ["https://existing-demo.example.test"]


def test_fastapi_parses_the_opt_in_microsoft_sso_registration_contract(monkeypatch) -> None:
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", "postgresql://postpilot:postpilot@localhost:5432/postpilot")
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "a-long-enough-fastapi-session-secret-value")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_ENABLED", "false")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_SPA_CLIENT_ID", "postpilot-spa")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_API_AUDIENCE", "api://postpilot-api")
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_ALLOWED_TENANT_IDS", "tenant-a, tenant-b")
    monkeypatch.setenv(
        "POSTPILOT_MICROSOFT_SSO_REDIRECT_URIS",
        "https://postpilot.example.test/sign-in/,http://localhost:5000/sign-in",
    )
    monkeypatch.setenv("POSTPILOT_MICROSOFT_SSO_REQUIRED_SCOPE", "api://postpilot-api/access_as_user")

    settings = Settings(_env_file=None)

    assert settings.microsoft_sso_enabled is False
    assert settings.microsoft_sso_spa_client_id == "postpilot-spa"
    assert settings.microsoft_sso_api_audience == "api://postpilot-api"
    assert settings.microsoft_sso_allowed_tenant_ids == ["tenant-a", "tenant-b"]
    assert settings.microsoft_sso_redirect_uris == [
        "https://postpilot.example.test/sign-in/",
        "http://localhost:5000/sign-in",
    ]
    assert settings.microsoft_sso_required_scope == "api://postpilot-api/access_as_user"


def test_kubernetes_maps_legacy_secret_source_keys_to_fastapi_runtime_keys() -> None:
    manifests = [
        (ROOT / "deploy/eks-demo/kubernetes/secret-provider-class.yaml").read_text(),
        (ROOT / "deploy/eks-ha/kubernetes/secret-provider-class.yaml").read_text(),
    ]

    for manifest in manifests:
        assert "objectName: POSTPILOT_SESSION_SECRET" in manifest
        assert "key: POSTPILOT_SESSION_SECRET" in manifest
        assert "objectName: POSTPILOT_FRONTEND_ORIGINS" in manifest
        assert "key: POSTPILOT_FRONTEND_ORIGINS" in manifest
        assert 'path: "POSTPILOT_SESSION_SECRET || NEXTAUTH_SECRET"' in manifest
        assert 'path: "POSTPILOT_FRONTEND_ORIGINS || NEXTAUTH_URL"' in manifest
