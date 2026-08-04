"""Integration coverage for selecting room and artist actuals for invoices."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Booking component invoice tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _ready_invoice_profile(lab: ProductionApiLab, episode_id: str) -> None:
    lab.execute(
        "UPDATE episodes SET workflow_status = 'complete' WHERE organization_id = $1 AND id = $2",
        lab.data.organization_id,
        episode_id,
    )
    lab.execute(
        """
        INSERT INTO invoice_settings (
          id, organization_id, legal_name, legal_address, billing_email,
          tax_enabled, tax_name, tax_rate_percent, payment_terms_days
        ) VALUES ($1, $2, 'Booking Invoice Post Ltd', '1 Facility Road, London',
          'billing@booking.test', false, 'VAT', 0, 30)
        """,
        str(uuid4()),
        lab.data.organization_id,
    )


def test_booking_components_are_selected_individually_and_become_itemised_invoice_lines(
    production_lab: ProductionApiLab,
) -> None:
    lab = production_lab
    lab.sign_in_as_manager()
    episode_id = _episode_id(lab)
    _ready_invoice_profile(lab, episode_id)
    rate = lab.client.post(
        "/v1/rate-cards/services",
        json={
            "name": "Component invoice edit suite",
            "category": "Edit suite",
            "unit": "hour",
            "rate": "100.00",
        },
    )
    assert rate.status_code == 201, rate.text
    booking = lab.client.post(
        "/v1/bookings",
        json={
            "title": "Client editorial review",
            "episode_id": episode_id,
            "room_id": lab.data.room_id,
            "person_id": lab.data.manager_person_id,
            "starts_at": "2035-12-10T09:00:00Z",
            "ends_at": "2035-12-10T12:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert booking.status_code == 201, booking.text
    actual = lab.client.post(
        f"/v1/bookings/{booking.json()['id']}/time-submissions",
        json={
            "actual_starts_at": "2035-12-10T09:00:00Z",
            "actual_ends_at": "2035-12-10T12:00:00Z",
            "overtime_minutes": 30,
        },
    )
    assert actual.status_code == 201, actual.text

    readiness = lab.client.get(f"/v1/billing/episodes/{episode_id}/readiness")
    assert readiness.status_code == 200, readiness.text
    components = readiness.json()["booking_components"]
    assert {component["component_type"] for component in components} == {"room", "person"}
    assert all(component["selection_status"] == "awaiting_selection" for component in components)
    room_component = next(component for component in components if component["component_type"] == "room")
    person_component = next(component for component in components if component["component_type"] == "person")

    missing_reason = lab.client.put(
        f"/v1/billing/booking-components/{person_component['id']}/invoice-selection",
        json={"include_in_invoice": False},
    )
    assert missing_reason.status_code == 422
    excluded = lab.client.put(
        f"/v1/billing/booking-components/{person_component['id']}/invoice-selection",
        json={"include_in_invoice": False, "reason": "Artist time is included in the agreed package."},
    )
    assert excluded.status_code == 200, excluded.text
    included = lab.client.put(
        f"/v1/billing/booking-components/{room_component['id']}/invoice-selection",
        json={"include_in_invoice": True},
    )
    assert included.status_code == 200, included.text

    selected = lab.client.get(f"/v1/billing/episodes/{episode_id}/readiness")
    assert selected.status_code == 200, selected.text
    assert selected.json()["ready_to_issue"] is True
    selected_room = next(item for item in selected.json()["booking_components"] if item["id"] == room_component["id"])
    assert selected_room["selection_status"] == "included"
    assert selected_room["actual_quantity"] == 3.0
    assert selected_room["actual_overtime_quantity"] == 0.5
    assert selected_room["actual_amount"] == 375.0

    issued = lab.client.post("/v1/billing/invoices", json={"episode_id": episode_id})
    assert issued.status_code == 201, issued.text
    items = lab.client.get(f"/v1/billing/invoices/{issued.json()['id']}/export")
    assert items.status_code == 200, items.text
    assert [
        {
            "quantity": item["quantity"],
            "unit_amount": item["unit_amount"],
            "amount": item["amount"],
            "booking_date": item["booking_date"],
            "episode": item["episode"],
            "resource": item["resource"],
            "saved_rate": item["saved_rate"],
            "source_booking_id": item["source_booking_id"],
        }
        for item in items.json()["items"]
    ] == [
        {
            "quantity": 3.0,
            "unit_amount": 100.0,
            "amount": 300.0,
            "booking_date": "2035-12-10",
            "episode": {"code": "PYS101", "title": "Prior Python episode"},
            "resource": {"type": "room", "name": "Python Edit Bay"},
            "saved_rate": 100.0,
            "source_booking_id": booking.json()["id"],
        },
        {
            "quantity": 0.5,
            "unit_amount": 150.0,
            "amount": 75.0,
            "booking_date": "2035-12-10",
            "episode": {"code": "PYS101", "title": "Prior Python episode"},
            "resource": {"type": "room", "name": "Python Edit Bay"},
            "saved_rate": 100.0,
            "source_booking_id": booking.json()["id"],
        },
    ]

    locked = lab.client.put(
        f"/v1/billing/booking-components/{room_component['id']}/invoice-selection",
        json={"include_in_invoice": False, "reason": "Too late."},
    )
    assert locked.status_code == 409

    # A void writes negative reversals of the exact original rows; it does not
    # consult the booking's current rate or reprice its duration.  It also
    # releases the component safely for a corrected replacement invoice.
    voided = lab.client.post(
        f"/v1/billing/invoices/{issued.json()['id']}/void",
        json={"reason": "Client changed the approved billing reference."},
    )
    assert voided.status_code == 200, voided.text
    assert voided.json()["reversal_line_count"] == 2
    assert voided.json()["reversed_amount"] == -375.0
    assert lab.client.get(f"/v1/billing/invoices/{issued.json()['id']}/export").status_code == 409
    ledger = lab.fetchrow(
        """
        SELECT
          (SELECT count(*)::int FROM client_invoice_line_reversals
           WHERE organization_id = $1 AND client_invoice_id = $2) AS reversal_count,
          (SELECT sum(amount)::text FROM client_invoice_line_reversals
           WHERE organization_id = $1 AND client_invoice_id = $2) AS reversal_amount,
          (SELECT count(*)::int FROM client_invoice_items
           WHERE organization_id = $1 AND client_invoice_id = $2 AND voided_at IS NOT NULL) AS voided_item_count
        """,
        lab.data.organization_id,
        issued.json()["id"],
    )
    assert ledger and dict(ledger) == {
        "reversal_count": 2,
        "reversal_amount": "-375.00",
        "voided_item_count": 2,
    }
    reissued = lab.client.post("/v1/billing/invoices", json={"episode_id": episode_id})
    assert reissued.status_code == 201, reissued.text
    assert reissued.json()["total_amount"] == 375.0
    commercial_audit = lab.fetchrow(
        """
        SELECT
          count(*) FILTER (WHERE action = 'booking_component.invoice_included')::int AS selection_count,
          count(*) FILTER (WHERE action = 'client_invoice.issued')::int AS issue_count,
          count(*) FILTER (WHERE action = 'client_invoice.voided')::int AS void_count
        FROM activity_log
        WHERE organization_id = $1
        """,
        lab.data.organization_id,
    )
    assert commercial_audit and dict(commercial_audit) == {
        "selection_count": 1,
        "issue_count": 2,
        "void_count": 1,
    }

    # Simulate a later operational correction to the booking component.  The
    # issued replacement must still export its original line snapshots rather
    # than reading today's component rate or actual quantities.
    lab.execute(
        """
        UPDATE booking_charge_components
        SET client_rate = 999.00, actual_quantity = 9, actual_overtime_quantity = 0,
            actual_client_amount = 8991.00
        WHERE organization_id = $1 AND id = $2
        """,
        lab.data.organization_id,
        room_component["id"],
    )
    immutable_export = lab.client.get(f"/v1/billing/invoices/{reissued.json()['id']}/export")
    assert immutable_export.status_code == 200, immutable_export.text
    assert [item["amount"] for item in immutable_export.json()["items"]] == [300.0, 75.0]
    assert [item["saved_rate"] for item in immutable_export.json()["items"]] == [100.0, 100.0]
