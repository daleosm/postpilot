"""Tenant-safe catering requests attached to a client's active booking."""

from __future__ import annotations

import json
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


def test_worker_catering_requires_an_active_booking_or_assigned_work_order(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.execute(
        """
        UPDATE organization_role_policies
        SET permissions = $1::jsonb
        WHERE organization_id = $2 AND role = 'production_manager'
        """,
        json.dumps(
            [
                "manage_settings",
                "manage_production",
                "do_assigned_work",
                "sign_off_work",
                "view_all_operations",
                "manage_qc_delivery",
                "manage_commercial",
                "manage_catering",
                "request_catering",
            ]
        ),
        production_lab.data.organization_id,
    )
    production_lab.sign_in_as_manager()

    without_charge_source = production_lab.client.post(
        "/v1/catering-requests",
        json={
            "room_id": production_lab.data.room_id,
            "request_type": "tea_coffee",
            "item": "Unlinked floor coffee",
        },
    )
    assert without_charge_source.status_code == 400

    episode_id = str(
        production_lab.fetchval(
            "SELECT id::text FROM episodes WHERE organization_id = $1 ORDER BY created_at NULLS FIRST LIMIT 1",
            production_lab.data.organization_id,
        )
    )
    work_order_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, kind, title,
          assignee_person_id, priority, is_blocking, status,
          billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'internal', 'work_order', 'Current conform correction',
          $4, 'normal', false, 'in_progress', 'included', 'not_billable', 'GBP'
        )
        """,
        work_order_id,
        production_lab.data.organization_id,
        episode_id,
        production_lab.data.manager_person_id,
    )

    resources = production_lab.client.get("/v1/catering/resources")
    assert resources.status_code == 200, resources.text
    assert resources.json()["active_work_order"]["id"] == work_order_id

    created = production_lab.client.post(
        "/v1/catering-requests",
        json={
            "work_order_id": work_order_id,
            "room_id": production_lab.data.room_id,
            "request_type": "tea_coffee",
            "item": "Colour suite coffee",
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    billed = production_lab.client.patch(
        f"/v1/catering-requests/{request_id}",
        json={"status": "delivered", "actual_cost": 11.50},
    )
    assert billed.status_code == 200, billed.text
    charged = production_lab.fetchrow(
        """
        SELECT b.episode_id::text AS billable_episode_id,
               l.episode_id::text AS budget_episode_id,
               l.work_order_id::text AS budget_work_order_id,
               l.actual_amount::float AS actual_amount
        FROM catering_requests c
        JOIN billables b ON b.id = c.billable_id
        JOIN budget_lines l ON l.id = c.budget_line_id
        WHERE c.id = $1
        """,
        request_id,
    )
    assert charged and dict(charged) == {
        "billable_episode_id": episode_id,
        "budget_episode_id": episode_id,
        "budget_work_order_id": work_order_id,
        "actual_amount": 11.5,
    }
