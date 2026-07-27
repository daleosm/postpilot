"""Server-side Microsoft Entra API access-token validation."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import jwt
from email_validator import EmailNotValidError, validate_email
from jwt import InvalidTokenError, PyJWK

from app.config import Settings, get_settings

JWKS_CACHE_SECONDS = 60 * 60
TOKEN_LEEWAY_SECONDS = 60
MICROSOFT_PROVIDER = "microsoft_entra"

JsonFetcher = Callable[[str], Awaitable[dict[str, Any]]]


class MicrosoftSsoConfigurationError(RuntimeError):
    """The administrator enabled SSO without the complete contract."""


class MicrosoftTokenValidationError(ValueError):
    """An untrusted or unsuitable Microsoft bearer token was supplied."""


@dataclass(frozen=True)
class MicrosoftAccessToken:
    issuer: str
    tenant_id: str
    subject: str
    object_id: str
    verified_email: str


@dataclass(frozen=True)
class _OpenIdConfiguration:
    issuer: str
    keys: tuple[dict[str, Any], ...]
    expires_at: float


async def _fetch_json(url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0), follow_redirects=False) as client:
            response = await client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise MicrosoftTokenValidationError("Microsoft signing metadata is unavailable.") from error
    if not isinstance(payload, dict):
        raise MicrosoftTokenValidationError("Microsoft signing metadata is invalid.")
    return payload


def _uuid_claim(value: object, claim: str) -> str:
    if not isinstance(value, str):
        raise MicrosoftTokenValidationError(f"Microsoft token is missing {claim}.")
    try:
        return str(UUID(value))
    except ValueError as error:
        raise MicrosoftTokenValidationError(f"Microsoft token has an invalid {claim}.") from error


def _required_scope_name(scope: str) -> str:
    configured = scope.strip()
    if not configured:
        raise MicrosoftSsoConfigurationError("Microsoft SSO delegated scope is not configured.")
    return configured.rsplit("/", 1)[-1]


class MicrosoftTokenValidator:
    """Validate Entra v2 delegated API tokens with bounded JWKS caching."""

    def __init__(
        self,
        settings: Settings,
        *,
        fetch_json: JsonFetcher = _fetch_json,
        cache_seconds: int = JWKS_CACHE_SECONDS,
    ) -> None:
        self.settings = settings
        self._fetch_json = fetch_json
        self._cache_seconds = cache_seconds
        self._metadata: dict[str, _OpenIdConfiguration] = {}

    def _validate_configuration(self) -> None:
        if not self.settings.microsoft_sso_enabled:
            raise MicrosoftSsoConfigurationError("Microsoft SSO is not enabled.")
        if not self.settings.microsoft_sso_spa_client_id:
            raise MicrosoftSsoConfigurationError("Microsoft SSO SPA client ID is not configured.")
        if not self.settings.microsoft_sso_api_audience:
            raise MicrosoftSsoConfigurationError("Microsoft SSO API audience is not configured.")
        if not self.settings.microsoft_sso_allowed_tenant_ids:
            raise MicrosoftSsoConfigurationError("Microsoft SSO allowed tenants are not configured.")
        _required_scope_name(self.settings.microsoft_sso_required_scope or "")

    def _discovery_url(self, tenant_id: str) -> str:
        authority = urlsplit(self.settings.microsoft_sso_authority)
        if authority.scheme != "https" or not authority.netloc or authority.query or authority.fragment:
            raise MicrosoftSsoConfigurationError("Microsoft SSO authority must be an HTTPS Entra authority URL.")
        return f"https://{authority.netloc}/{tenant_id}/v2.0/.well-known/openid-configuration"

    async def _configuration_for(self, tenant_id: str, *, force_refresh: bool = False) -> _OpenIdConfiguration:
        cached = self._metadata.get(tenant_id)
        if cached and not force_refresh and cached.expires_at > time.monotonic():
            return cached

        discovery = await self._fetch_json(self._discovery_url(tenant_id))
        issuer = discovery.get("issuer")
        jwks_uri = discovery.get("jwks_uri")
        if not isinstance(issuer, str) or not isinstance(jwks_uri, str):
            raise MicrosoftTokenValidationError("Microsoft signing metadata is incomplete.")
        parsed_jwks_uri = urlsplit(jwks_uri)
        authority_host = urlsplit(self.settings.microsoft_sso_authority).hostname
        if (
            parsed_jwks_uri.scheme != "https"
            or not parsed_jwks_uri.hostname
            or parsed_jwks_uri.hostname.lower() != (authority_host or "").lower()
        ):
            raise MicrosoftTokenValidationError("Microsoft JWKS endpoint is not trusted.")
        jwks = await self._fetch_json(jwks_uri)
        keys = jwks.get("keys")
        if not isinstance(keys, list) or not all(isinstance(key, dict) for key in keys):
            raise MicrosoftTokenValidationError("Microsoft signing keys are invalid.")
        configuration = _OpenIdConfiguration(
            issuer=issuer.replace("{tenantid}", tenant_id),
            keys=tuple(keys),
            expires_at=time.monotonic() + self._cache_seconds,
        )
        self._metadata[tenant_id] = configuration
        return configuration

    async def _signing_key(self, tenant_id: str, key_id: str) -> tuple[_OpenIdConfiguration, dict[str, Any]]:
        configuration = await self._configuration_for(tenant_id)
        key = next((candidate for candidate in configuration.keys if candidate.get("kid") == key_id), None)
        if key is None:
            # Entra rotates keys. A single forced refresh allows a newly issued
            # token through without trusting a stale in-process JWKS cache.
            configuration = await self._configuration_for(tenant_id, force_refresh=True)
            key = next((candidate for candidate in configuration.keys if candidate.get("kid") == key_id), None)
        if key is None:
            raise MicrosoftTokenValidationError("Microsoft signing key is unknown.")
        key_issuer = key.get("issuer")
        if isinstance(key_issuer, str) and key_issuer.replace("{tenantid}", tenant_id) != configuration.issuer:
            raise MicrosoftTokenValidationError("Microsoft signing key issuer is invalid.")
        return configuration, key

    def _validate_audience(self, audience: object) -> None:
        configured = (self.settings.microsoft_sso_api_audience or "").strip()
        accepted = {configured}
        # Entra v2 access tokens use the API application client ID as `aud`;
        # v1 tokens may use the matching Application ID URI.
        if configured.startswith("api://"):
            accepted.add(configured.removeprefix("api://"))
        elif configured:
            accepted.add(f"api://{configured}")
        values = (
            {audience}
            if isinstance(audience, str)
            else set(audience)
            if isinstance(audience, list) and all(isinstance(value, str) for value in audience)
            else set()
        )
        if not values.intersection(accepted):
            raise MicrosoftTokenValidationError("Microsoft token audience is invalid.")

    def _validate_scope_and_actor(self, claims: dict[str, Any]) -> None:
        if claims.get("ver") != "2.0":
            raise MicrosoftTokenValidationError("Microsoft token version is not supported.")
        scopes = claims.get("scp")
        if not isinstance(scopes, str):
            # This rejects app-only and ID tokens: neither has the delegated
            # `scp` claim required by this browser sign-in flow.
            raise MicrosoftTokenValidationError("Microsoft token is not a delegated API access token.")
        required_scope = _required_scope_name(self.settings.microsoft_sso_required_scope or "")
        if required_scope not in set(scopes.split()):
            raise MicrosoftTokenValidationError("Microsoft token does not grant the required API scope.")
        if claims.get("azp") != self.settings.microsoft_sso_spa_client_id:
            raise MicrosoftTokenValidationError("Microsoft token actor is not the configured PostPilot SPA.")
        if claims.get("idtyp") == "app":
            raise MicrosoftTokenValidationError("Microsoft application tokens cannot sign in users.")

    async def validate_access_token(self, token: str) -> MicrosoftAccessToken:
        self._validate_configuration()
        if token.count(".") != 2 or len(token) > 16_384:
            raise MicrosoftTokenValidationError("Microsoft token is malformed.")
        try:
            header = jwt.get_unverified_header(token)
            unverified = jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
        except InvalidTokenError as error:
            raise MicrosoftTokenValidationError("Microsoft token is malformed.") from error
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise MicrosoftTokenValidationError("Microsoft token signing algorithm is invalid.")
        tenant_id = _uuid_claim(unverified.get("tid"), "tenant ID")
        allowed_tenants = {value.lower() for value in self.settings.microsoft_sso_allowed_tenant_ids}
        if tenant_id.lower() not in allowed_tenants:
            raise MicrosoftTokenValidationError("Microsoft tenant is not allowed.")

        configuration, jwk = await self._signing_key(tenant_id, header["kid"])
        try:
            claims = jwt.decode(
                token,
                key=PyJWK.from_dict(jwk).key,
                algorithms=["RS256"],
                issuer=configuration.issuer,
                options={
                    "verify_aud": False,
                    "require": ["exp", "nbf", "iat", "iss", "aud", "tid", "sub", "oid", "scp"],
                },
                leeway=TOKEN_LEEWAY_SECONDS,
            )
        except (InvalidTokenError, ValueError) as error:
            raise MicrosoftTokenValidationError("Microsoft token validation failed.") from error

        if _uuid_claim(claims.get("tid"), "tenant ID") != tenant_id:
            raise MicrosoftTokenValidationError("Microsoft token tenant changed during validation.")
        self._validate_audience(claims.get("aud"))
        self._validate_scope_and_actor(claims)
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise MicrosoftTokenValidationError("Microsoft token is missing subject.")
        object_id = _uuid_claim(claims.get("oid"), "object ID")
        email = claims.get("email")
        if not isinstance(email, str):
            raise MicrosoftTokenValidationError("Microsoft token is missing a verified work email.")
        try:
            verified_email = validate_email(email, check_deliverability=False, test_environment=True).normalized
        except EmailNotValidError as error:
            raise MicrosoftTokenValidationError("Microsoft token has an invalid work email.") from error
        return MicrosoftAccessToken(
            issuer=configuration.issuer,
            tenant_id=tenant_id,
            subject=subject,
            object_id=object_id,
            verified_email=verified_email,
        )


@lru_cache
def get_microsoft_token_validator() -> MicrosoftTokenValidator:
    return MicrosoftTokenValidator(get_settings())
