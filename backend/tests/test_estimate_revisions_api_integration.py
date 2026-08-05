"""Immutable episode-estimate revisions and forecast calculations."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Estimate revision API integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _line(lab: ProductionApiLab, episode_id: str, amount: float = 100) -> str:
    response = lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": episode_id, "category": "Python estimate planning", "budgeted_amount": amount},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _overview(lab: ProductionApiLab, episode_id: str) -> dict[str, object]:
    response = lab.client.get(f"/v1/budget/episodes/{episode_id}/estimate-overview")
    assert response.status_code == 200, response.text
    return response.json()["estimate"]


def test_initial_estimate_is_immutable_and_revision_forecast_uses_actual_plus_remaining_plan(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    line_id = _line(production_lab, episode_id, 100)

    original = production_lab.client.post(
        f"/v1/budget/episodes/{episode_id}/estimate-revisions",
        json={
            "name": "Original episode estimate",
            "reason": "Approved baseline for editorial finishing.",
            "approve_immediately": True,
        },
    )
    assert original.status_code == 201, original.text
    estimate = original.json()["estimate"]
    assert estimate["original_estimate"] == 100
    assert estimate["current_approved_estimate"] == 100
    assert estimate["forecast"] == 100
    assert estimate["is_locked"] is True

    locked = production_lab.client.patch(f"/v1/budget/lines/{line_id}", json={"budgeted_amount": 140})
    assert locked.status_code == 409
    assert "locked" in locked.json()["detail"].lower()
    locked_add = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": episode_id, "category": "Late addition", "budgeted_amount": 10},
    )
    assert locked_add.status_code == 409

    actual = production_lab.client.post(
        f"/v1/budget/lines/{line_id}/manual-actual-adjustments",
        json={"amount": 25, "reason": "Confirmed finishing time."},
    )
    assert actual.status_code == 201, actual.text
    assert _overview(production_lab, episode_id)["forecast"] == 100
    cannot_delete_actual = production_lab.client.delete(f"/v1/budget/lines/{line_id}")
    assert cannot_delete_actual.status_code == 409

    draft = production_lab.client.post(
        f"/v1/budget/episodes/{episode_id}/estimate-revisions",
        json={"name": "Client change revision", "reason": "Client requested a revised finishing allowance."},
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["estimate"]["open_revision_id"]
    assert draft_id
    duplicate_draft = production_lab.client.post(
        f"/v1/budget/episodes/{episode_id}/estimate-revisions",
        json={"name": "Duplicate", "reason": "A second draft must not overwrite the working revision."},
    )
    assert duplicate_draft.status_code == 409

    changed = production_lab.client.patch(f"/v1/budget/lines/{line_id}", json={"budgeted_amount": 140})
    assert changed.status_code == 200, changed.text
    working = _overview(production_lab, episode_id)
    assert working["forecast_basis"] == "open_revision"
    assert working["forecast"] == 140
    approved = production_lab.client.post(f"/v1/budget/episodes/{episode_id}/estimate-revisions/{draft_id}/approve")
    assert approved.status_code == 200, approved.text
    estimate = approved.json()["estimate"]
    assert estimate["original_estimate"] == 100
    assert estimate["current_approved_estimate"] == 140
    assert estimate["actual"] == 25
    assert estimate["remaining_planned"] == 115
    assert estimate["forecast"] == 140
    assert estimate["variance"] == 0
    assert [revision["status"] for revision in estimate["revisions"]] == ["approved", "superseded"]

    action = production_lab.fetchval(
        "SELECT action FROM activity_log WHERE organization_id = $1 AND entity_id = $2 "
        "ORDER BY created_at DESC LIMIT 1",
        production_lab.data.organization_id,
        str(draft_id),
    )
    assert action == "budget_estimate_revision.approved"


def test_estimate_revision_is_capability_and_tenant_scoped(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    _line(production_lab, episode_id)

    foreign = production_lab.client.get(
        f"/v1/budget/episodes/{production_lab.data.foreign_episode_id}/estimate-overview"
    )
    assert foreign.status_code == 404
    foreign_create = production_lab.client.post(
        f"/v1/budget/episodes/{production_lab.data.foreign_episode_id}/estimate-revisions",
        json={"name": "Foreign", "reason": "Must never cross a tenant boundary."},
    )
    assert foreign_create.status_code == 404

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    denied = production_lab.client.get(f"/v1/budget/episodes/{episode_id}/estimate-overview")
    assert denied.status_code == 403


def test_operational_ledger_traces_actual_sources_and_flags_unallocated_time(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    line_id = _line(production_lab, episode_id, 180)
    adjusted = production_lab.client.post(
        f"/v1/budget/lines/{line_id}/manual-actual-adjustments",
        json={"amount": 35, "reason": "Confirmed supervised mix support.", "reference": "MIX-TEST-01"},
    )
    assert adjusted.status_code == 201, adjusted.text

    rate = production_lab.client.post(
        "/v1/rate-cards/services",
        json={"name": "Unallocated editorial room", "category": "Edit suite", "unit": "hour", "rate": 100},
    )
    assert rate.status_code == 201, rate.text
    booking = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Python unallocated edit actual",
            "episode_id": episode_id,
            "room_id": production_lab.data.room_id,
            "starts_at": "2035-12-14T09:00:00Z",
            "ends_at": "2035-12-14T10:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
            "commercial_treatment": "dry_hire",
        },
    )
    assert booking.status_code == 201, booking.text
    unallocated_booking_id = booking.json()["id"]
    submitted = production_lab.client.post(
        f"/v1/bookings/{unallocated_booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-12-14T09:00:00Z",
            "actual_ends_at": "2035-12-14T10:00:00Z",
            "overtime_minutes": 0,
        },
    )
    assert submitted.status_code == 201, submitted.text
    ledger = production_lab.client.get(f"/v1/budget/episodes/{episode_id}/operational-ledger")
    assert ledger.status_code == 200, ledger.text
    payload = ledger.json()["ledger"]
    actual = next(item for item in payload["actuals"] if item["budget_item"]["id"] == line_id)
    assert actual["amount"] == 35
    assert actual["source_type"] == "manual_adjustment"
    assert actual["reference"] == "MIX-TEST-01"
    attention = next(item for item in payload["unallocated_actuals"] if item["booking_id"] == unallocated_booking_id)
    assert attention["reason"] == "No matching internal estimate item was found for this commercial component."

    foreign = production_lab.client.get(
        f"/v1/budget/episodes/{production_lab.data.foreign_episode_id}/operational-ledger"
    )
    assert foreign.status_code == 404


def test_booking_budget_context_exposes_amounts_only_to_commercial_users(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    line_id = _line(production_lab, episode_id, 150)
    viewer_person_id = str(
        production_lab.fetchval(
            "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
            production_lab.data.organization_id,
            production_lab.data.viewer_user_id,
        )
    )
    booking_id = str(uuid4())
    now = datetime.now(UTC)
    production_lab.execute(
        """
        INSERT INTO bookings (
          id, organization_id, episode_id, budget_line_id, person_id, title, starts_at, ends_at,
          setup_minutes, handover_minutes, approved_overtime_minutes, is_option, status, booking_type
        ) VALUES ($1, $2, $3, $4, $5, 'Python budget-linked booking', $6, $7, 0, 0, 0, false, 'confirmed', 'edit')
        """,
        booking_id,
        production_lab.data.organization_id,
        episode_id,
        line_id,
        viewer_person_id,
        now,
        now + timedelta(hours=1),
    )
    manager_rows = production_lab.client.get("/v1/bookings")
    assert manager_rows.status_code == 200, manager_rows.text
    manager_booking = next(item for item in manager_rows.json()["bookings"] if item["id"] == booking_id)
    assert manager_booking["budget_item_context"]["remaining_estimate"] == 150

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    viewer_rows = production_lab.client.get("/v1/bookings")
    assert viewer_rows.status_code == 200, viewer_rows.text
    viewer_booking = next(item for item in viewer_rows.json()["bookings"] if item["id"] == booking_id)
    assert viewer_booking["budget_item"]["id"] == line_id
    assert "budget_item_context" not in viewer_booking
