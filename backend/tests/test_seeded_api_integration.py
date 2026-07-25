"""FastAPI equivalents for the seeded auth, tenant, show, and episode journeys.

These tests intentionally run against the same migrated PostgreSQL seed used
by the existing browser suite. They verify the FastAPI server boundary
directly; React interaction details remain covered by TypeScript Playwright
tests.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Seeded FastAPI integration tests run in CI after PostgreSQL migration and seed.",
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    database_url = (
        os.getenv("POSTPILOT_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or "postgresql://postpilot:postpilot@localhost:5432/postpilot"
    )
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", database_url)
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "postpilot-ci-auth-secret-which-is-long-enough")
    monkeypatch.setenv("POSTPILOT_DEBUG_DEMO", "true")
    get_settings.cache_clear()

    # Delayed import matters: the module-level production ASGI app reads its
    # settings on import, while each test must receive the deterministic CI
    # environment above.
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()


def sign_in_as_maya(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/v1/auth/sign-in",
        json={"email": "maya@postpilot.debug", "password": "password"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def alternate_membership(session: dict[str, object]) -> dict[str, str]:
    active = session["active_organization_id"]
    return next(membership for membership in session["memberships"] if membership["organization_id"] != active)


def test_credentials_create_an_opaque_session_with_a_valid_tenant_context(client: TestClient) -> None:
    session = sign_in_as_maya(client)

    assert session["authenticated_user_id"] == "user_maya"
    assert session["user_id"] == "user_maya"
    assert session["active_organization_id"]
    assert len(session["memberships"]) >= 2
    assert "manage_production" in session["permissions"]
    assert client.cookies.get("postpilot_session")


def test_session_endpoint_rejects_an_unauthenticated_browser(client: TestClient) -> None:
    response = client.get("/v1/auth/session")

    assert response.status_code == 401
    assert response.json()["detail"] == "Sign-in required."


def test_invalid_credentials_do_not_create_an_authenticated_session(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/sign-in",
        json={"email": "maya@postpilot.debug", "password": "incorrect"},
    )

    assert response.status_code == 401
    assert client.get("/v1/auth/session").status_code == 401


def test_active_tenant_switch_only_accepts_a_real_membership(client: TestClient) -> None:
    session = sign_in_as_maya(client)
    other = alternate_membership(session)

    switched = client.post(
        "/v1/organizations/active",
        json={"organization_id": other["organization_id"], "pathname": "/shows"},
    )
    assert switched.status_code == 200
    assert switched.json()["active_organization_id"] == other["organization_id"]

    rejected = client.post(
        "/v1/organizations/active",
        json={"organization_id": str(uuid4()), "pathname": "/shows"},
    )
    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "You are not a member of that post house."


def test_active_tenant_switch_drops_a_nested_show_route_from_the_previous_tenant(client: TestClient) -> None:
    session = sign_in_as_maya(client)
    tenant_a_shows = client.get("/v1/shows")
    assert tenant_a_shows.status_code == 200
    show_id = tenant_a_shows.json()["shows"][0]["id"]

    switched = client.post(
        "/v1/organizations/active",
        json={"organization_id": alternate_membership(session)["organization_id"], "pathname": f"/shows/{show_id}"},
    )

    assert switched.status_code == 200
    assert switched.json()["redirect_to"] == "/"
    assert client.get(f"/v1/shows/{show_id}").status_code == 404
    assert client.get(f"/v1/shows/{show_id}/workspace").status_code == 404


def test_active_show_selection_is_tenant_scoped_and_persisted_in_the_session(client: TestClient) -> None:
    session = sign_in_as_maya(client)
    tenant_a_shows = client.get("/v1/shows")
    show_id = tenant_a_shows.json()["shows"][0]["id"]

    selected = client.post("/v1/organizations/active-show", json={"show_id": show_id})
    assert selected.status_code == 200
    assert selected.json()["active_show"] == {"id": show_id, "title": tenant_a_shows.json()["shows"][0]["title"]}

    client.post(
        "/v1/organizations/active",
        json={"organization_id": alternate_membership(session)["organization_id"], "pathname": "/shows"},
    )
    assert client.post("/v1/organizations/active-show", json={"show_id": show_id}).status_code == 404


def test_show_episode_dashboard_and_form_reads_are_all_active_tenant_scoped(client: TestClient) -> None:
    sign_in_as_maya(client)

    shows = client.get("/v1/shows")
    episodes = client.get("/v1/episodes")
    dashboard = client.get("/v1/dashboard")
    form_options = client.get("/v1/shows/options/form")

    assert shows.status_code == episodes.status_code == dashboard.status_code == form_options.status_code == 200
    assert shows.json()["shows"]
    assert all(episode["show_id"] for episode in episodes.json()["episodes"])
    assert {"metrics", "episodes", "shows", "schedule", "team", "budget", "activity"} <= dashboard.json().keys()
    assert {"companies", "people", "seasons"} <= form_options.json().keys()


def test_show_workspace_contains_only_the_authorized_show_read_model(client: TestClient) -> None:
    sign_in_as_maya(client)
    show_id = client.get("/v1/shows").json()["shows"][0]["id"]

    response = client.get(f"/v1/shows/{show_id}/workspace")

    assert response.status_code == 200
    workspace = response.json()
    assert {"show", "seasons", "episodes", "team", "contacts", "activity"} <= workspace.keys()
    assert workspace["show"]["id"] == show_id
    assert all(episode["show_id"] == show_id for episode in workspace["episodes"])


def test_debug_switching_keeps_the_authenticator_but_resolves_the_selected_users_membership(client: TestClient) -> None:
    sign_in_as_maya(client)
    debug_users = client.get("/v1/debug/users")
    assert debug_users.status_code == 200
    replacement = next(user for user in debug_users.json() if user["user_id"] != "user_maya")

    assumed = client.put("/v1/debug/user", json={"user_id": replacement["user_id"], "pathname": "/budget"})

    assert assumed.status_code == 200
    context = assumed.json()
    assert context["authenticated_user_id"] == "user_maya"
    assert context["user_id"] == replacement["user_id"]
    assert context["active_organization_id"] in {item["organization_id"] for item in context["memberships"]}


def test_debug_switcher_refuses_unknown_people(client: TestClient) -> None:
    sign_in_as_maya(client)

    response = client.put("/v1/debug/user", json={"user_id": "missing-debug-user"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Debug user not found."


def test_sign_out_revokes_the_current_opaque_session(client: TestClient) -> None:
    sign_in_as_maya(client)

    response = client.post("/v1/auth/sign-out")

    assert response.status_code == 204
    assert client.get("/v1/auth/session").status_code == 401
