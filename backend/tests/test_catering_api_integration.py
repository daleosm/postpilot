"""Tenant-safe catering requests attached to a client's active booking."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Catering FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def test_client_catering_uses_own_active_booking_but_allows_room_override(
    production_lab: ProductionApiLab,
) -> None:
    now = datetime.now(UTC)
    booking_id = str(uuid4())
    override_room_id = str(uuid4())
    other_booking_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO rooms (id, organization_id, name, type)
        VALUES ($1, $2, 'Client move room', 'client_review')
        """,
        override_room_id,
        production_lab.data.organization_id,
    )
    for identifier, guest_person_id in (
        (booking_id, production_lab.data.client_person_id),
        (other_booking_id, None),
    ):
        production_lab.execute(
            """
            INSERT INTO bookings (
              id, organization_id, room_id, episode_id, guest_person_id, title,
              starts_at, ends_at, setup_minutes, handover_minutes,
              approved_overtime_minutes, is_option, status, booking_type
            ) VALUES ($1, $2, $3, $4, $5, 'Active client review', $6, $7, 0, 0, 0, false, 'confirmed', 'client_review')
            """,
            identifier,
            production_lab.data.organization_id,
            production_lab.data.room_id,
            production_lab.fetchval(
                "SELECT id::text FROM episodes WHERE organization_id = $1 ORDER BY created_at NULLS FIRST LIMIT 1",
                production_lab.data.organization_id,
            ),
            guest_person_id,
            now - timedelta(hours=1),
            now + timedelta(hours=1),
        )

    session = production_lab.sign_in_as_client()
    assert "request_catering" in session["permissions"]
    resources = production_lab.client.get("/v1/catering/resources")
    assert resources.status_code == 200, resources.text
    assert resources.json()["active_booking"]["id"] == booking_id
    assert resources.json()["active_booking"]["room_id"] == production_lab.data.room_id

    created = production_lab.client.post(
        "/v1/catering-requests",
        json={
            "booking_id": booking_id,
            "room_id": override_room_id,
            "request_type": "lunch",
            "item": "Client lunch after room move",
        },
    )
    assert created.status_code == 201, created.text
    saved = production_lab.fetchrow(
        "SELECT booking_id::text, room_id::text FROM catering_requests WHERE id = $1", created.json()["id"]
    )
    assert saved and dict(saved) == {"booking_id": booking_id, "room_id": override_room_id}

    foreign_to_client = production_lab.client.post(
        "/v1/catering-requests",
        json={
            "booking_id": other_booking_id,
            "room_id": production_lab.data.room_id,
            "request_type": "snack",
            "item": "Unauthorised booking charge",
        },
    )
    assert foreign_to_client.status_code == 404
