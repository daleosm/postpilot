"""FastAPI equivalents for the seeded auth, tenant, show, and episode journeys.

These tests intentionally run against the same migrated PostgreSQL seed used
by the existing browser suite. They verify the FastAPI server boundary
directly; React interaction details remain covered by TypeScript Playwright
tests.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.demo_seed import uid

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


def test_show_episode_dashboard_and_form_reads_are_all_active_tenant_scoped(client: TestClient) -> None:
    sign_in_as_maya(client)

    shows = client.get("/v1/shows")
    episodes = client.get("/v1/episodes")
    dashboard = client.get("/v1/dashboard")
    form_options = client.get("/v1/shows/options/form")

    assert shows.status_code == episodes.status_code == dashboard.status_code == form_options.status_code == 200
    assert shows.json()["shows"]
    assert all(episode["show_id"] for episode in episodes.json()["episodes"])
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
    assert {"companies", "people", "seasons"} <= form_options.json().keys()


def test_dashboard_work_order_attention_is_an_exception_queue(client: TestClient) -> None:
    sign_in_as_maya(client)

    response = client.get("/v1/dashboard")

    assert response.status_code == 200
    cutoff = datetime.now(UTC) + timedelta(hours=48)
    for item in response.json()["work_order_attention"]:
        due_soon_or_overdue = bool(
            item["due_at"] and datetime.fromisoformat(item["due_at"].replace("Z", "+00:00")) <= cutoff
        )
        unassigned = not item["assignee_person_id"] and not item["assignee_role"]
        blocks_pending_sign_off = (
            item["is_blocking"]
            and item["episode_workflow_status"] == "awaiting_sign_off"
            and item["work_order_stage_id"]
            and item["work_order_stage_id"] == item["episode_workflow_stage_id"]
        )
        assert due_soon_or_overdue or unassigned or blocks_pending_sign_off


def test_demo_calendar_and_work_orders_exercise_current_operational_states(client: TestClient) -> None:
    sign_in_as_maya(client)

    bookings = client.get("/v1/bookings")
    work_orders = client.get("/v1/work-orders")
    debug_users = client.get("/v1/debug/users")

    assert bookings.status_code == work_orders.status_code == debug_users.status_code == 200
    booking_rows = bookings.json()["bookings"]
    work_order_rows = work_orders.json()["work_orders"]

    assert len(booking_rows) >= 12
    assert any(item["is_option"] and item["option_rank"] == 1 for item in booking_rows)
    assert any(item["is_option"] and item["option_rank"] == 2 for item in booking_rows)
    assert any(item["work_order_id"] for item in booking_rows)
    assert any(item["actual_starts_at"] and item["approved_overtime_minutes"] for item in booking_rows)
    assert {"open", "in_progress", "ready_for_review", "complete"} <= {item["status"] for item in work_order_rows}
    assert any(
        item["work_type"] == "internal" and item["status"] == "in_progress" and not item["booking_id"]
        for item in work_order_rows
    )
    assert all(
        not user["name"].startswith(("Northstar Post ", "Riverside Post ", "Horizon Finish "))
        for user in debug_users.json()
    )


def test_seeded_budget_demo_has_rate_snapshots_real_actual_sources_and_separate_po_ledgers(client: TestClient) -> None:
    """The public fixtures demonstrate a real estimate-to-actual path.

    The assertions deliberately span different episodes: grade time is a
    booking submission, editorial support is a work-order actual, and the
    supplier invoice is an external-cost actual. This makes the UI's trace
    drill-down meaningful without relying on invented category totals.
    """
    sign_in_as_maya(client)
    organization_id = "10000000-0000-4000-8000-000000000001"
    selected = client.post("/v1/organizations/active", json={"organization_id": organization_id, "pathname": "/budget"})
    assert selected.status_code == 200, selected.text

    colour_episode_id = uid(1, "27", 5)
    colour = client.get(f"/v1/budget/episodes/{colour_episode_id}/operational-ledger")
    assert colour.status_code == 200, colour.text
    colour_ledger = colour.json()["ledger"]
    booking_actual = next(item for item in colour_ledger["actuals"] if item["source_type"] == "booking")
    assert booking_actual["budget_item"]["category"] == "Colour"
    assert booking_actual["booking"]["room_name"]
    assert booking_actual["time_submission"]["actual_starts_at"]

    editorial_episode_id = uid(1, "27", 3)
    editorial = client.get(f"/v1/budget/episodes/{editorial_episode_id}/operational-ledger")
    assert editorial.status_code == 200, editorial.text
    work_order_actual = next(
        item for item in editorial.json()["ledger"]["actuals"] if item["source_type"] == "work_order"
    )
    assert work_order_actual["budget_item"]["category"] == "Editorial artists"
    assert work_order_actual["work_order"]["title"] == "Prepare editorial turnover notes"

    external_episode_id = uid(1, "27", 1)
    external = client.get(f"/v1/budget/episodes/{external_episode_id}/operational-ledger")
    assert external.status_code == 200, external.text
    invoice_actual = next(
        item for item in external.json()["ledger"]["actuals"] if item["source_type"] == "vendor_invoice"
    )
    assert invoice_actual["budget_item"]["category"] == "External vendors"
    assert invoice_actual["vendor_invoice"]["invoice_number"] == "NORTHSTAR-POST-V-001"

    rate = client.get(
        "/v1/rate-cards/effective",
        params={
            "episode_id": colour_episode_id,
            "category": "Colour suite",
            "unit": "hour",
            "target_type": "room",
            "target_id": uid(1, "28", 3),
        },
    )
    assert rate.status_code == 200, rate.text
    assert rate.json()["effective_rate"]["source"] == "master_rate_card"
    assert rate.json()["effective_rate"]["rate"] == 190

    estimate = client.get(f"/v1/budget/episodes/{external_episode_id}/estimate-overview")
    summary = client.get(f"/v1/budget/episodes/{external_episode_id}/summary")
    assert estimate.status_code == summary.status_code == 200
    assert estimate.json()["estimate"]["is_locked"] is True
    assert estimate.json()["estimate"]["original_estimate"] == estimate.json()["estimate"]["current_approved_estimate"]
    # A supplier invoice is a cost allocation and a PO actual, but must not
    # inflate the episode actual twice merely because it also appears on a PO.
    assert summary.json()["summary"]["actual_amount"] == 2750
    assert summary.json()["summary"]["purchase_orders"]["actual_invoiced_amount"] == 2750


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


def test_debug_switching_from_an_inaccessible_episode_uses_my_work_as_a_safe_fallback(client: TestClient) -> None:
    sign_in_as_maya(client)
    # This stable episode belongs to Northstar.  The Copperline producer has
    # no membership or team assignment there.
    episode_id = uid(1, "27", 1)
    assumed = client.put(
        "/v1/debug/user",
        # This Copperline-only user cannot access Maya's default Northstar
        # episode, so the debug switcher must choose its safe work queue.
        json={"user_id": "user_copper_producer", "pathname": f"/episodes/{episode_id}"},
    )

    assert assumed.status_code == 200
    assert assumed.json()["redirect_to"] == "/review"


def test_seeded_episode_team_nominates_the_configured_online_editor_as_workflow_signer(client: TestClient) -> None:
    sign_in_as_maya(client)
    copperline_id = "10000000-0000-4000-8000-000000000005"
    selected = client.post("/v1/organizations/active", json={"organization_id": copperline_id, "pathname": "/"})
    assert selected.status_code == 200

    workspace = client.get(f"/v1/episodes/{uid(5, '27', 1)}/workspace")
    assert workspace.status_code == 200, workspace.text
    online_signers = [signer for signer in workspace.json()["workflow_signers"] if signer["role"] == "online_editor"]

    assert len(online_signers) == 1
    assert online_signers[0]["name"] == "Skyler Dean"


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
