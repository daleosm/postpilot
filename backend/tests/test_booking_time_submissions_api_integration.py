"""FastAPI actual-time tests for work-order-linked facility bookings."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Booking actual FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _viewer_person_id(lab: ProductionApiLab) -> str:
    person_id = lab.fetchval(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        lab.data.organization_id,
        lab.data.viewer_user_id,
    )
    assert person_id
    return str(person_id)


def _create_linked_booking(lab: ProductionApiLab) -> tuple[str, str]:
    viewer_person_id = _viewer_person_id(lab)
    lab.sign_in_as_manager()
    booking = lab.client.post(
        "/v1/bookings",
        json={
            "title": "Work-order edit actuals",
            "room_id": lab.data.room_id,
            "episode_id": _episode_id(lab),
            "person_id": viewer_person_id,
            "starts_at": "2035-08-20T09:00:00Z",
            "ends_at": "2035-08-20T12:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert booking.status_code == 201, booking.text
    booking_id = booking.json()["id"]
    work_order_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, booking_id, work_type, kind, title,
          assignee_person_id, priority, is_blocking, status, billing_scope,
          billing_status, currency
        ) VALUES (
          $1, $2, $3, $4, 'internal', 'work_order', 'Editorial title adjustment',
          $5, 'normal', false, 'in_progress', 'included', 'not_billable', 'GBP'
        )
        """,
        work_order_id,
        lab.data.organization_id,
        _episode_id(lab),
        booking_id,
        viewer_person_id,
    )
    rate_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO service_rates (id, organization_id, name, category, unit, rate, currency, is_active)
        VALUES ($1, $2, 'Python edit suite', 'Edit suite', 'hour', 100, 'GBP', true)
        """,
        rate_id,
        lab.data.organization_id,
    )
    lab.execute("UPDATE people SET hourly_rate = 50 WHERE id = $1", viewer_person_id)
    return booking_id, work_order_id


def _create_budgeted_booking(lab: ProductionApiLab) -> tuple[str, str]:
    """Create one internal estimate item and book it before time is confirmed."""
    viewer_person_id = _viewer_person_id(lab)
    lab.sign_in_as_manager()
    episode_id = _episode_id(lab)
    service_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO service_rates (id, organization_id, name, category, unit, rate, currency, is_active)
        VALUES ($1, $2, 'Snapshot booking suite', 'Edit suite', 'hour', 100, 'GBP', true)
        """,
        service_id,
        lab.data.organization_id,
    )
    line = lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Edit suite",
            "planned_quantity": 1,
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": service_id,
        },
    )
    assert line.status_code == 201, line.text
    booking = lab.client.post(
        "/v1/bookings",
        json={
            "title": "Budgeted editorial actuals",
            "room_id": lab.data.room_id,
            "episode_id": episode_id,
            "budget_line_id": line.json()["id"],
            "person_id": viewer_person_id,
            "starts_at": "2035-09-20T09:00:00Z",
            "ends_at": "2035-09-20T12:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert booking.status_code == 201, booking.text
    return booking.json()["id"], line.json()["id"]


def test_assigned_artist_confirms_linked_booking_actuals_with_live_room_and_person_costs(
    production_lab: ProductionApiLab,
) -> None:
    booking_id, work_order_id = _create_linked_booking(production_lab)
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()

    submitted = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-08-20T09:00:00Z",
            "actual_ends_at": "2035-08-20T12:00:00Z",
            "overtime_minutes": 30,
            "note": "Client notes extended the edit pass.",
        },
    )
    duplicate = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-08-20T09:00:00Z",
            "actual_ends_at": "2035-08-20T12:00:00Z",
            "overtime_minutes": 30,
        },
    )

    assert submitted.status_code == 201, submitted.text
    assert duplicate.status_code == 409
    body = submitted.json()
    assert body == {
        "confirmed": True,
        "booking_id": booking_id,
        "time_overrun": True,
        "actual_internal_cost": 525.0,
        "currency": "GBP",
        "cost": {
            "actual_hours": 3.5,
            "overtime_minutes": 30,
            "currency": "GBP",
            "room": {
                "category": "Edit suite",
                "rate": 100.0,
                "unit": "hour",
                "source": "facility_rate_card",
                "cost": 350.0,
            },
            "artist": {
                "person_id": _viewer_person_id(production_lab),
                "name": "Python Production Viewer",
                "rate": 50.0,
                "unit": "hour",
                "source": "person_hourly_rate",
                "cost": 175.0,
            },
            "total_internal_cost": 525.0,
        },
        "work_order_id": work_order_id,
    }
    booking = production_lab.fetchrow(
        """
        SELECT actual_starts_at, actual_ends_at, approved_overtime_minutes
        FROM bookings WHERE id = $1
        """,
        booking_id,
    )
    assert booking and booking["actual_starts_at"].isoformat() == "2035-08-20T09:00:00+00:00"
    assert booking["actual_ends_at"].isoformat() == "2035-08-20T12:00:00+00:00"
    assert booking["approved_overtime_minutes"] == 30
    assert (
        production_lab.fetchval("SELECT actual_amount::text FROM post_work_orders WHERE id = $1", work_order_id)
        == "525.00"
    )
    actions = production_lab.fetchval(
        """
        SELECT count(*) FROM activity_log
        WHERE organization_id = $1
          AND ((entity_type = 'booking' AND entity_id = $2 AND action = 'booking.time_overrun_recorded')
            OR (entity_type = 'post_work_order' AND entity_id = $3 AND action = 'work_order.time_logged'))
        """,
        production_lab.data.organization_id,
        booking_id,
        work_order_id,
    )
    assert actions == 2

    production_lab.sign_out()
    production_lab.sign_in_as_manager()
    reviewed = production_lab.client.get(f"/v1/bookings/{booking_id}/time-submissions")
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["submitted"] is True
    assert reviewed.json()["cost"]["total_internal_cost"] == 525.0
    assert reviewed.json()["work_order"] == {
        "id": work_order_id,
        "actual_amount": "525.00",
        "currency": "GBP",
    }


def test_booking_actuals_use_the_active_episode_room_rate_before_the_facility_fallback(
    production_lab: ProductionApiLab,
) -> None:
    booking_id, work_order_id = _create_linked_booking(production_lab)
    rate_card_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO rate_cards (id, organization_id, episode_id, name, currency, is_active)
        VALUES ($1, $2, $3, 'Episode edit suite override', 'GBP', true)
        """,
        rate_card_id,
        production_lab.data.organization_id,
        _episode_id(production_lab),
    )
    production_lab.execute(
        """
        INSERT INTO rate_card_items (id, organization_id, rate_card_id, category, unit, rate)
        VALUES ($1, $2, $3, 'Edit suite', 'hour', 120)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        rate_card_id,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()

    submitted = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-08-20T09:00:00Z",
            "actual_ends_at": "2035-08-20T12:00:00Z",
            "overtime_minutes": 0,
        },
    )

    assert submitted.status_code == 201, submitted.text
    assert submitted.json()["cost"] == {
        "actual_hours": 3.0,
        "overtime_minutes": 0,
        "currency": "GBP",
        "room": {
            "category": "Edit suite",
            "rate": 120.0,
            "unit": "hour",
            "source": "episode_rate_card",
            "cost": 360.0,
        },
        "artist": {
            "person_id": _viewer_person_id(production_lab),
            "name": "Python Production Viewer",
            "rate": 50.0,
            "unit": "hour",
            "source": "person_hourly_rate",
            "cost": 150.0,
        },
        "total_internal_cost": 510.0,
    }
    assert (
        production_lab.fetchval("SELECT actual_amount::text FROM post_work_orders WHERE id = $1", work_order_id)
        == "510.00"
    )


def test_booking_actuals_enforce_owner_tenant_and_input_boundaries(production_lab: ProductionApiLab) -> None:
    booking_id, _ = _create_linked_booking(production_lab)
    manager_booking = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Another artist booking",
            "room_id": production_lab.data.room_id,
            "episode_id": _episode_id(production_lab),
            "person_id": production_lab.data.manager_person_id,
            "starts_at": "2035-08-21T09:00:00Z",
            "ends_at": "2035-08-21T12:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert manager_booking.status_code == 201, manager_booking.text
    foreign_booking_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO bookings (
          id, organization_id, room_id, episode_id, person_id, title, starts_at, ends_at,
          setup_minutes, handover_minutes, approved_overtime_minutes, is_option, status, booking_type
        ) VALUES ($1, $2, $3, $4, $5, 'Foreign actuals', '2035-08-22T09:00:00Z', '2035-08-22T12:00:00Z',
                  0, 0, 0, false, 'confirmed', 'edit')
        """,
        foreign_booking_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_room_id,
        production_lab.data.foreign_episode_id,
        production_lab.data.foreign_person_id,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    payload = {
        "actual_starts_at": "2035-08-20T09:00:00Z",
        "actual_ends_at": "2035-08-20T12:00:00Z",
        "overtime_minutes": 0,
    }
    other_person = production_lab.client.post(
        f"/v1/bookings/{manager_booking.json()['id']}/time-submissions", json=payload
    )
    foreign = production_lab.client.post(f"/v1/bookings/{foreign_booking_id}/time-submissions", json=payload)
    invalid_overtime = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions", json={**payload, "overtime_minutes": 721}
    )
    injected_cost = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions", json={**payload, "actual_internal_cost": 1}
    )
    assert other_person.status_code == 403
    assert foreign.status_code == 404
    assert invalid_overtime.status_code == injected_cost.status_code == 422

    production_lab.sign_out()
    production_lab.sign_in_as_client()
    client_submission = production_lab.client.post(f"/v1/bookings/{booking_id}/time-submissions", json=payload)
    assert client_submission.status_code == 403


def test_confirmed_time_uses_the_booking_budget_item_saved_rate_snapshot(production_lab: ProductionApiLab) -> None:
    booking_id, budget_line_id = _create_budgeted_booking(production_lab)
    resources = production_lab.client.get("/v1/bookings/resources")
    assert resources.status_code == 200, resources.text
    assert any(item["id"] == budget_line_id and item["has_rate_snapshot"] for item in resources.json()["budget_items"])
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()

    submitted = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-09-20T09:00:00Z",
            "actual_ends_at": "2035-09-20T12:00:00Z",
            "overtime_minutes": 30,
        },
    )

    assert submitted.status_code == 201, submitted.text
    assert submitted.json()["actual_internal_cost"] >= 0
    allocation = production_lab.fetchrow(
        """
        SELECT budget_line_id::text, source_type, amount::text, currency
        FROM budget_actual_allocations
        WHERE organization_id = $1 AND booking_id = $2
        """,
        production_lab.data.organization_id,
        booking_id,
    )
    assert allocation is not None
    assert dict(allocation) == {
        "budget_line_id": budget_line_id,
        "source_type": "booking",
        "amount": "350.00",
        "currency": "GBP",
    }
    budget_actual = production_lab.fetchval(
        "SELECT actual_amount::text FROM budget_lines WHERE id = $1",
        budget_line_id,
    )
    assert budget_actual == "350.00"
    listed = production_lab.client.get("/v1/bookings")
    row = next(item for item in listed.json()["bookings"] if item["id"] == booking_id)
    assert row["budget_line_id"] == budget_line_id
    assert row["actual_budget_status"] == "allocated"


def test_actual_time_without_a_budget_item_is_visible_as_unallocated(production_lab: ProductionApiLab) -> None:
    booking_id, _ = _create_linked_booking(production_lab)
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    submitted = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-08-20T09:00:00Z",
            "actual_ends_at": "2035-08-20T12:00:00Z",
            "overtime_minutes": 0,
        },
    )
    assert submitted.status_code == 201, submitted.text
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM budget_actual_allocations WHERE organization_id = $1 AND booking_id = $2",
            production_lab.data.organization_id,
            booking_id,
        )
        == 0
    )
    listed = production_lab.client.get("/v1/bookings")
    row = next(item for item in listed.json()["bookings"] if item["id"] == booking_id)
    assert row["actual_budget_status"] == "unallocated"


def test_booking_budget_item_rejects_foreign_and_wrong_episode_links(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    foreign_line_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO budget_lines (
          id, organization_id, show_id, episode_id, external_cost, category,
          budgeted_amount, actual_amount, currency, cost_type
        ) VALUES ($1, $2, $3, $4, false, 'Foreign edit', 10, 0, 'GBP', 'internal')
        """,
        foreign_line_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_show_id,
        production_lab.data.foreign_episode_id,
    )
    foreign = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Foreign budget item",
            "room_id": production_lab.data.room_id,
            "episode_id": episode_id,
            "budget_line_id": foreign_line_id,
            "starts_at": "2035-10-20T09:00:00Z",
            "ends_at": "2035-10-20T12:00:00Z",
        },
    )
    assert foreign.status_code == 404


def test_work_order_room_reservation_preserves_its_internal_budget_item(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    work_order_id, budget_line_id = str(uuid4()), str(uuid4())
    production_lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, kind, title, assignee_person_id,
          priority, is_blocking, status, billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'internal', 'work_order', 'Budgeted sound correction', $4,
          'normal', false, 'in_progress', 'included', 'not_billable', 'GBP'
        )
        """,
        work_order_id,
        production_lab.data.organization_id,
        episode_id,
        production_lab.data.manager_person_id,
    )
    production_lab.execute(
        """
        INSERT INTO budget_lines (
          id, organization_id, show_id, episode_id, work_order_id, external_cost,
          category, budgeted_amount, planned_quantity, planned_unit, rate_snapshot,
          rate_source, resource_reference, estimate_status, actual_amount, currency, cost_type
        ) VALUES (
          $1, $2, $3, $4, $5, false,
          'Sound', 300, 3, 'hour', 100,
          'master_rate_card', 'service:manual-sound', 'approved', 0, 'GBP', 'internal'
        )
        """,
        budget_line_id,
        production_lab.data.organization_id,
        production_lab.data.show_id,
        episode_id,
        work_order_id,
    )

    reserved = production_lab.client.post(
        f"/v1/work-orders/{work_order_id}/booking",
        json={
            "room_id": production_lab.data.room_id,
            "starts_at": "2035-11-20T09:00:00Z",
            "ends_at": "2035-11-20T12:00:00Z",
        },
    )

    assert reserved.status_code == 201, reserved.text
    booking_budget_item = production_lab.fetchval(
        "SELECT budget_line_id::text FROM bookings WHERE id = $1",
        reserved.json()["id"],
    )
    assert booking_budget_item == budget_line_id
