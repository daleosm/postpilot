from __future__ import annotations

import json
import time
from collections.abc import Callable
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import Settings
from app.microsoft_sso import MicrosoftSsoConfigurationError, MicrosoftTokenValidationError, MicrosoftTokenValidator

TENANT_ID = str(uuid4())
OBJECT_ID = str(uuid4())
ISSUER = f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"
JWKS_URI = "https://login.microsoftonline.com/common/discovery/v2.0/keys"


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        database_url="postgresql://postpilot:postpilot@localhost:5432/postpilot",
        session_secret="a-long-enough-fastapi-session-secret-value",
        microsoft_sso_enabled=True,
        microsoft_sso_spa_client_id="postpilot-spa-client-id",
        microsoft_sso_authority="https://login.microsoftonline.com/organizations",
        microsoft_sso_api_audience="api://postpilot-api-client-id",
        microsoft_sso_allowed_tenant_ids=[TENANT_ID],
        microsoft_sso_required_scope="api://postpilot-api-client-id/access_as_user",
    )


def _jwk(private_key, key_id: str) -> dict[str, object]:
    value = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    value.update({"kid": key_id, "alg": "RS256", "use": "sig", "issuer": ISSUER})
    return value


def _token(private_key, key_id: str, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": ISSUER,
        "aud": "postpilot-api-client-id",
        "exp": now + 600,
        "nbf": now - 5,
        "iat": now,
        "tid": TENANT_ID,
        "sub": "pairwise-user-subject",
        "oid": OBJECT_ID,
        "scp": "access_as_user openid profile email",
        "azp": "postpilot-spa-client-id",
        "ver": "2.0",
        "email": "sso.user@postpilot.test",
    }
    claims.update(overrides)
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": key_id, "typ": "JWT"})


def _fetcher(keys: list[dict[str, object]], calls: list[str]) -> Callable[[str], object]:
    async def fetch(url: str) -> dict[str, object]:
        calls.append(url)
        if url == JWKS_URI:
            return {"keys": keys}
        return {"issuer": ISSUER, "jwks_uri": JWKS_URI}

    return fetch


@pytest.mark.asyncio
async def test_validates_a_delegated_access_token_and_caches_jwks() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    calls: list[str] = []
    validator = MicrosoftTokenValidator(_settings(), fetch_json=_fetcher([_jwk(key, "key-1")], calls))

    first = await validator.validate_access_token(_token(key, "key-1"))
    second = await validator.validate_access_token(_token(key, "key-1"))

    assert first.tenant_id == TENANT_ID
    assert first.object_id == OBJECT_ID
    assert first.verified_email == "sso.user@postpilot.test"
    assert second.subject == "pairwise-user-subject"
    assert calls == [
        f"https://login.microsoftonline.com/{TENANT_ID}/v2.0/.well-known/openid-configuration",
        JWKS_URI,
    ]


@pytest.mark.asyncio
async def test_refreshes_jwks_once_for_a_rotated_key() -> None:
    old_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    new_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    fetch_count = 0

    async def fetch(url: str) -> dict[str, object]:
        nonlocal fetch_count
        if url == JWKS_URI:
            fetch_count += 1
            return {"keys": [_jwk(old_key, "old")] if fetch_count == 1 else [_jwk(new_key, "new")]}
        return {"issuer": ISSUER, "jwks_uri": JWKS_URI}

    validator = MicrosoftTokenValidator(_settings(), fetch_json=fetch)

    result = await validator.validate_access_token(_token(new_key, "new"))

    assert result.object_id == OBJECT_ID
    assert fetch_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("claim", "value"),
    [
        ("iss", "https://login.microsoftonline.com/not-the-allowed-tenant/v2.0"),
        ("scp", None),  # An ID token or app-only token is not accepted.
        ("aud", "other-api"),
        ("tid", str(uuid4())),
        ("exp", int(time.time()) - 120),
        ("azp", "untrusted-spa"),
        ("email", None),
    ],
)
async def test_rejects_unsuitable_or_untrusted_tokens(claim: str, value: object) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    claims = {claim: value}
    token = _token(key, "key-1", **claims)
    validator = MicrosoftTokenValidator(_settings(), fetch_json=_fetcher([_jwk(key, "key-1")], []))

    with pytest.raises(MicrosoftTokenValidationError):
        await validator.validate_access_token(token)


@pytest.mark.asyncio
async def test_rejects_a_token_with_a_forged_signature() -> None:
    trusted_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    validator = MicrosoftTokenValidator(_settings(), fetch_json=_fetcher([_jwk(trusted_key, "key-1")], []))

    # The attacker deliberately reuses the trusted key ID.  The validator must
    # still verify the signature against the actual Entra JWKS material.
    with pytest.raises(MicrosoftTokenValidationError):
        await validator.validate_access_token(_token(attacker_key, "key-1"))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("description", "claims"),
    [
        ("future not-before", {"nbf": int(time.time()) + 600}),
        ("application token", {"idtyp": "app"}),
        ("unsupported token version", {"ver": "1.0"}),
    ],
)
async def test_rejects_other_noninteractive_or_not_yet_valid_tokens(
    description: str, claims: dict[str, object]
) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    validator = MicrosoftTokenValidator(_settings(), fetch_json=_fetcher([_jwk(key, "key-1")], []))

    with pytest.raises(MicrosoftTokenValidationError):
        await validator.validate_access_token(_token(key, "key-1", **claims))


@pytest.mark.asyncio
@pytest.mark.parametrize("token", ["not-a-jwt", "a.b.c", "x" * 16_385])
async def test_rejects_malformed_or_oversized_tokens_before_network_trust(token: str) -> None:
    validator = MicrosoftTokenValidator(_settings(), fetch_json=_fetcher([], []))

    with pytest.raises(MicrosoftTokenValidationError):
        await validator.validate_access_token(token)


@pytest.mark.asyncio
async def test_rejects_an_unknown_signing_key_after_one_jwks_refresh() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    fetch_count = 0

    async def fetch(url: str) -> dict[str, object]:
        nonlocal fetch_count
        if url == JWKS_URI:
            fetch_count += 1
            return {"keys": [_jwk(key, "known-key")]}
        return {"issuer": ISSUER, "jwks_uri": JWKS_URI}

    validator = MicrosoftTokenValidator(_settings(), fetch_json=fetch)

    with pytest.raises(MicrosoftTokenValidationError):
        await validator.validate_access_token(_token(key, "unknown-key"))
    assert fetch_count == 2


@pytest.mark.asyncio
async def test_rejects_untrusted_discovery_and_jwks_endpoints() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    async def fetch(url: str) -> dict[str, object]:
        if url == JWKS_URI:
            return {"keys": [_jwk(key, "key-1")]}
        return {"issuer": ISSUER, "jwks_uri": "https://keys.attacker.example/jwks"}

    validator = MicrosoftTokenValidator(_settings(), fetch_json=fetch)
    with pytest.raises(MicrosoftTokenValidationError):
        await validator.validate_access_token(_token(key, "key-1"))


@pytest.mark.asyncio
async def test_rejects_invalid_runtime_authority_before_fetching_metadata() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    settings = _settings().model_copy(update={"microsoft_sso_authority": "http://not-https.example"})
    validator = MicrosoftTokenValidator(settings, fetch_json=_fetcher([_jwk(key, "key-1")], []))

    with pytest.raises(MicrosoftSsoConfigurationError):
        await validator.validate_access_token(_token(key, "key-1"))
