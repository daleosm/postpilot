import pytest
from pydantic import ValidationError

from app.config import Settings
from app.security import (
    hash_node_scrypt_password,
    safe_auth_redirect,
    safe_callback_path,
    verify_node_scrypt_password,
)


def test_password_hashes_use_independent_salts_and_verify_only_the_original_password() -> None:
    first = hash_node_scrypt_password("password")
    second = hash_node_scrypt_password("password")

    assert first != second
    assert verify_node_scrypt_password("password", first)
    assert not verify_node_scrypt_password("not-password", first)


def test_password_verification_rejects_missing_and_malformed_hashes() -> None:
    assert not verify_node_scrypt_password("password", None)
    assert not verify_node_scrypt_password("password", "not-a-password-hash")
    assert not verify_node_scrypt_password("password", "scrypt$missing")


def test_settings_require_an_adequate_session_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="postgresql://localhost/postpilot", session_secret="too-short")
    settings = Settings(
        database_url="postgresql://localhost/postpilot",
        session_secret="a" * 32,
        environment="production",
        cookie_secure=True,
    )
    assert settings.cookie_secure is True and settings.environment == "production"


def test_callback_paths_never_leave_the_application_origin() -> None:
    assert safe_callback_path("/shows?filter=active") == "/shows?filter=active"
    assert safe_callback_path("https://evil.example") == "/"
    assert safe_callback_path("//evil.example") == "/"
    assert safe_auth_redirect("/shows", "https://postpilot.example") == "https://postpilot.example/shows"
    assert safe_auth_redirect("https://evil.example", "https://postpilot.example") == "https://postpilot.example/"
