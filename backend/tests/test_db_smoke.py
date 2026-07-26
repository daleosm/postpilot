from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Database smoke tests run in CI after the shared PostgreSQL seed.",
)


def test_fastapi_session_and_tenant_boundary_against_seeded_postgres(monkeypatch) -> None:
    database_url = (
        os.getenv("POSTPILOT_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or "postgresql://postpilot:postpilot@localhost:5432/postpilot"
    )
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", database_url)
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "postpilot-ci-auth-secret-which-is-long-enough")
    monkeypatch.setenv("POSTPILOT_DEBUG_DEMO", "true")
    get_settings.cache_clear()
    from app.main import create_app

    with TestClient(create_app()) as client:
        signed_in = client.post(
            "/v1/auth/sign-in",
            json={"email": "maya@postpilot.debug", "password": "password"},
        )
        assert signed_in.status_code == 200
        session = signed_in.json()
        assert session["active_organization_id"]
        assert "manage_production" in session["permissions"]

        tenant_a_shows = client.get("/v1/shows")
        assert tenant_a_shows.status_code == 200
        assert tenant_a_shows.json()["shows"]
        tenant_a_show_id = tenant_a_shows.json()["shows"][0]["id"]
        assert "season_count" in tenant_a_shows.json()["shows"][0]

        show_workspace = client.get(f"/v1/shows/{tenant_a_show_id}/workspace")
        assert show_workspace.status_code == 200
        assert {"show", "seasons", "episodes", "team", "contacts", "activity"} <= show_workspace.json().keys()

        # The create forms receive only active-tenant operational options.
        form_options = client.get("/v1/shows/options/form")
        assert form_options.status_code == 200
        assert {"companies", "people", "seasons"} <= form_options.json().keys()

        tenant_a_episodes = client.get("/v1/episodes")
        assert tenant_a_episodes.status_code == 200
        assert all(episode["show_id"] != "" for episode in tenant_a_episodes.json()["episodes"])

        dashboard = client.get("/v1/dashboard")
        assert dashboard.status_code == 200
        assert {
            "metrics",
            "episodes",
            "shows",
            "schedule",
            "team",
            "work_order_attention",
            "budget",
            "activity",
        } <= dashboard.json().keys()

        tenant_b = next(
            membership
            for membership in session["memberships"]
            if membership["organization_id"] != session["active_organization_id"]
        )
        switched = client.post(
            "/v1/organizations/active",
            json={
                "organization_id": tenant_b["organization_id"],
                # This route exists only in the prior tenant. The API must
                # select a safe destination after it changes the tenant.
                "pathname": f"/shows/{tenant_a_show_id}",
            },
        )
        assert switched.status_code == 200
        assert switched.json()["active_organization_id"] == tenant_b["organization_id"]
        assert switched.json()["redirect_to"] == "/"

        # A parameter copied from the previous post house must never resolve in
        # the new tenant, even for the multi-tenant debug administrator.
        assert client.get(f"/v1/shows/{tenant_a_show_id}").status_code == 404
        assert client.get(f"/v1/shows/{tenant_a_show_id}/workspace").status_code == 404

        # The FastAPI debug switcher is likewise server-owned: Maya may only
        # assume actual user records with at least one live membership.
        debug_users = client.get("/v1/debug/users")
        assert debug_users.status_code == 200
        replacement = next(user for user in debug_users.json() if user["user_id"] != "user_maya")
        assumed = client.put("/v1/debug/user", json={"user_id": replacement["user_id"], "pathname": "/budget"})
        assert assumed.status_code == 200
        assert assumed.json()["authenticated_user_id"] == "user_maya"
        assert assumed.json()["user_id"] == replacement["user_id"]
        assert assumed.json()["active_organization_id"] in {
            membership["organization_id"] for membership in assumed.json()["memberships"]
        }

        assert client.post("/v1/auth/sign-out").status_code == 204
        assert client.get("/v1/auth/session").status_code == 401

    get_settings.cache_clear()
