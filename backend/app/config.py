from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Secrets are injected by the deployment, never committed."""

    model_config = SettingsConfigDict(
        # When developing from `backend/`, also load the repository's standard
        # Next.js `.env.local`. Deployed workloads supply real environment
        # variables and do not rely on either file.
        env_file=(".env", "../.env.local"),
        env_prefix="POSTPILOT_",
        extra="ignore",
        populate_by_name=True,
    )

    # The Kubernetes Secret Provider maps the historical NEXTAUTH_* source
    # keys to these FastAPI-native environment variables during rollout. The
    # aliases also keep local installations working while their `.env.local`
    # is updated to the documented POSTPILOT_* keys.
    database_url: str = Field(validation_alias=AliasChoices("POSTPILOT_DATABASE_URL", "DATABASE_URL"))
    session_secret: str = Field(
        min_length=32,
        validation_alias=AliasChoices("POSTPILOT_SESSION_SECRET", "NEXTAUTH_SECRET"),
    )
    # Deployment values are deliberately human-friendly comma-separated URLs,
    # rather than a JSON array. `NoDecode` lets the validator below split them
    # before pydantic-settings attempts JSON decoding for a list field.
    frontend_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5000"],
        validation_alias=AliasChoices("POSTPILOT_FRONTEND_ORIGINS", "NEXTAUTH_URL"),
    )
    environment: str = "development"
    cookie_name: str = "postpilot_session"
    cookie_secure: bool = False
    session_ttl_days: int = Field(default=30, ge=1, le=90)
    debug_demo: bool = False
    demo_switcher_user_id: str = "user_maya"
    # Microsoft SSO is deliberately opt-in. The first rollout adds the route
    # contract and browser PKCE client but does not accept Entra tokens until
    # their validation and tenant-linking rules are implemented.
    microsoft_sso_enabled: bool = False
    microsoft_sso_spa_client_id: str | None = None
    microsoft_sso_authority: str = "https://login.microsoftonline.com/organizations"
    microsoft_sso_api_audience: str | None = None
    microsoft_sso_allowed_tenant_ids: Annotated[list[str], NoDecode] = Field(default_factory=list)
    microsoft_sso_redirect_uris: Annotated[list[str], NoDecode] = Field(default_factory=list)
    microsoft_sso_required_scope: str | None = None

    @field_validator("frontend_origins", mode="before")
    @classmethod
    def split_frontend_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("microsoft_sso_allowed_tenant_ids", "microsoft_sso_redirect_uris", mode="before")
    @classmethod
    def split_microsoft_sso_values(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            # Redirect URIs must remain byte-for-byte equivalent to their
            # Entra registration, so unlike frontend origins we never trim a
            # trailing slash here.
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql+asyncpg://"):
            return self.database_url
        if self.database_url.startswith("postgres://"):
            return "postgresql+asyncpg://" + self.database_url.removeprefix("postgres://")
        if self.database_url.startswith("postgresql://"):
            return "postgresql+asyncpg://" + self.database_url.removeprefix("postgresql://")
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
