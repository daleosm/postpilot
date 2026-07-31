"""Database-boundary safeguards for retries and monetary source ledgers."""

from __future__ import annotations

import os
from datetime import date
from uuid import uuid4

import asyncpg
import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Financial safeguard integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def test_database_rejects_duplicate_source_actuals_and_negative_financial_values(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    line = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": episode_id, "category": "Safeguard editorial", "budgeted_amount": "10.00"},
    )
    assert line.status_code == 201, line.text
    booking = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Safeguard source booking",
            "episode_id": episode_id,
            "room_id": production_lab.data.room_id,
            "person_id": production_lab.data.manager_person_id,
            "budget_line_id": line.json()["id"],
            "starts_at": "2035-08-02T09:00:00Z",
            "ends_at": "2035-08-02T10:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert booking.status_code == 201, booking.text

    first_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO budget_actual_allocations (
          id, organization_id, budget_line_id, source_type, booking_id,
          amount, currency, allocation_date
        ) VALUES ($1, $2, $3, 'booking', $4, 10.00, 'GBP', $5)
        """,
        first_id,
        production_lab.data.organization_id,
        line.json()["id"],
        booking.json()["id"],
        date(2035, 8, 2),
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        production_lab.execute(
            """
            INSERT INTO budget_actual_allocations (
              id, organization_id, budget_line_id, source_type, booking_id,
              amount, currency, allocation_date
            ) VALUES ($1, $2, $3, 'time_submission', $4, 10.00, 'GBP', $5)
            """,
            str(uuid4()),
            production_lab.data.organization_id,
            line.json()["id"],
            booking.json()["id"],
            date(2035, 8, 2),
        )

    with pytest.raises(asyncpg.CheckViolationError):
        production_lab.execute(
            """
            INSERT INTO billables (
              id, organization_id, vendor, amount, currency, status
            ) VALUES ($1, $2, 'Safeguard client', -0.01, 'GBP', 'approved')
            """,
            str(uuid4()),
            production_lab.data.organization_id,
        )


def test_financial_post_idempotency_replays_the_first_response_and_rejects_key_reuse(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    key = f"financial-safeguard-{uuid4()}"
    # Create a tenant-owned vendor first. The replay assertion is against the
    # live API, not a unit-test stand-in.
    vendor_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, $3, 'vendor')",
        vendor_id,
        production_lab.data.organization_id,
        "Idempotency supplier",
    )
    request = {
        "vendor_company_id": vendor_id,
        "po_number": f"SAFE-{uuid4().hex[:10].upper()}",
        "approved_amount": "25.00",
    }
    headers = {"Idempotency-Key": key}
    first = production_lab.client.post("/v1/purchase-orders", json=request, headers=headers)
    replay = production_lab.client.post("/v1/purchase-orders", json=request, headers=headers)

    assert first.status_code == 201, first.text
    assert replay.status_code == 201, replay.text
    assert replay.headers["Idempotency-Replayed"] == "true"
    assert replay.json()["id"] == first.json()["id"]
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM purchase_orders WHERE organization_id = $1 AND po_number = $2",
            production_lab.data.organization_id,
            request["po_number"],
        )
        == 1
    )

    changed = {**request, "approved_amount": "26.00"}
    mismatch = production_lab.client.post("/v1/purchase-orders", json=changed, headers=headers)
    assert mismatch.status_code == 409
    assert "different request" in mismatch.json()["detail"]
