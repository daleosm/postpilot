"""A fixed, realistic episode ledger that fails on an unexpected penny."""

from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Golden ledger tests run in CI against migrated PostgreSQL.",
)

_FIXTURE = Path(__file__).with_name("fixtures") / "episode_financial_ledger.json"


def _expected() -> dict[str, object]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _configure_invoice_profile(lab: ProductionApiLab, episode_id: str) -> None:
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
        ) VALUES ($1, $2, 'Golden Ledger Post Ltd', '1 Ledger Lane, London',
          'billing@golden-ledger.test', true, 'VAT', 20, 30)
        """,
        str(uuid4()),
        lab.data.organization_id,
    )


def _project_actual(item: dict[str, object]) -> dict[str, object]:
    return {
        "source_type": item["source_type"],
        "amount": item["amount"],
        "category": item["budget_item"]["category"],
        "reference": "booking-actual" if item["source_type"] == "booking" else item["reference"],
    }


def test_golden_episode_ledger_and_invoice_match_the_checked_in_penny_fixture(
    production_lab: ProductionApiLab,
) -> None:
    """Exercise the complete planned → actual → invoice hand-off once.

    IDs and timestamps are deliberately omitted from the projection below;
    every commercial amount, state, and source relationship is fixed in the
    JSON fixture and therefore changes only under deliberate review.
    """
    lab = production_lab
    lab.sign_in_as_manager()
    episode_id = _episode_id(lab)

    service = lab.client.post(
        "/v1/rate-cards/services",
        json={"name": "Golden editorial hour", "category": "Editorial", "unit": "hour", "rate": "127.37"},
    )
    assert service.status_code == 201, service.text
    editorial = lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Editorial",
            "description": "Golden fractional editorial finish",
            "planned_quantity": "2.75",
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": service.json()["id"],
        },
    )
    assert editorial.status_code == 201, editorial.text

    vendor_id = str(uuid4())
    lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Golden Colour Vendor', 'vendor')",
        vendor_id,
        lab.data.organization_id,
    )
    vendor_po = lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": lab.data.show_id,
            "episode_id": episode_id,
            "po_number": "GOLDEN-VENDOR-001",
            "approved_amount": "1250.00",
        },
    )
    assert vendor_po.status_code == 201, vendor_po.text
    vendor_po_id = vendor_po.json()["id"]
    approved_po = lab.client.patch(f"/v1/purchase-orders/{vendor_po_id}", json={"status": "approved"})
    assert approved_po.status_code == 200, approved_po.text
    external_colour = lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "External colour",
            "description": "Golden colour vendor scope",
            "external_cost": True,
            "budgeted_amount": "1250.00",
            "purchase_order_id": vendor_po_id,
        },
    )
    assert external_colour.status_code == 201, external_colour.text

    baseline = lab.client.post(
        f"/v1/budget/episodes/{episode_id}/estimate-revisions",
        json={
            "name": "Golden baseline",
            "reason": "Lock the reviewed golden ledger estimate.",
            "approve_immediately": True,
        },
    )
    assert baseline.status_code == 201, baseline.text

    booking_pricing = lab.client.post(
        "/v1/rate-cards/services",
        json={
            "name": "Golden edit booking rate",
            "category": "Edit suite",
            "unit": "hour",
            "rate": "100.00",
        },
    )
    assert booking_pricing.status_code == 201, booking_pricing.text

    booking = lab.client.post(
        "/v1/bookings",
        json={
            "title": "Golden fractional editorial finish",
            "episode_id": episode_id,
            "room_id": lab.data.room_id,
            "person_id": lab.data.manager_person_id,
            "budget_line_id": editorial.json()["id"],
            "starts_at": "2035-08-01T09:00:00Z",
            "ends_at": "2035-08-01T11:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert booking.status_code == 201, booking.text
    booking_id = booking.json()["id"]
    actual_time = lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-08-01T09:00:00Z",
            "actual_ends_at": "2035-08-01T11:00:00Z",
            "overtime_minutes": 45,
            "note": "Golden approved editorial overtime.",
        },
    )
    assert actual_time.status_code == 201, actual_time.text

    vendor_actual = lab.client.post(
        f"/v1/purchase-orders/{vendor_po_id}/actual-costs",
        json={
            "budget_line_id": external_colour.json()["id"],
            "invoice_number": "GOLDEN-SUP-001",
            "invoice_date": "2035-08-01",
            "amount": "833.33",
            "description": "Golden partial colour supplier invoice",
        },
    )
    assert vendor_actual.status_code == 201, vendor_actual.text

    client_po = lab.client.post(
        "/v1/client-purchase-orders",
        json={
            "client_company_id": lab.data.client_company_id,
            "show_id": lab.data.show_id,
            "episode_id": episode_id,
            "po_number": "GOLDEN-CLIENT-001",
            "approved_amount": "19.99",
        },
    )
    assert client_po.status_code == 201, client_po.text
    client_po_id = client_po.json()["id"]
    active_client_po = lab.client.patch(f"/v1/client-purchase-orders/{client_po_id}", json={"status": "active"})
    assert active_client_po.status_code == 200, active_client_po.text
    work_order = lab.client.post(
        "/v1/work-orders",
        json={
            "episode_id": episode_id,
            "workflow_stage_id": lab.data.workflow_stage_id,
            "booking_id": booking_id,
            "title": "Golden client editorial change",
            "work_type": "internal",
            "billing_scope": "billable_change",
            "client_purchase_order_id": client_po_id,
            "client_quote_amount": "19.99",
        },
    )
    assert work_order.status_code == 201, work_order.text
    work_order_id = work_order.json()["id"]
    assert lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"}).status_code == 200
    assert (
        lab.client.patch(
            f"/v1/work-orders/{work_order_id}",
            json={"status": "in_progress", "approval_note": "Golden change approved."},
        ).status_code
        == 200
    )
    assert lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "complete"}).status_code == 200
    billable = lab.client.post(
        f"/v1/billing/work-orders/{work_order_id}/billables",
        json={"reference": "GOLDEN-CHANGE"},
    )
    assert billable.status_code == 201, billable.text

    _configure_invoice_profile(lab, episode_id)
    invoice = lab.client.post("/v1/billing/invoices", json={"episode_id": episode_id})
    assert invoice.status_code == 201, invoice.text
    invoice_id = invoice.json()["id"]

    estimate = lab.client.get(f"/v1/budget/episodes/{episode_id}/estimate-overview")
    ledger = lab.client.get(f"/v1/budget/episodes/{episode_id}/operational-ledger")
    po_detail = lab.client.get(f"/v1/purchase-orders/{vendor_po_id}")
    export_readiness = lab.client.get(f"/v1/billing/invoices/{invoice_id}/export-readiness")
    exported = lab.client.get(f"/v1/billing/invoices/{invoice_id}/export")
    assert all(response.status_code == 200 for response in (estimate, ledger, po_detail, export_readiness, exported))

    estimate_payload = estimate.json()["estimate"]
    ledger_payload = ledger.json()["ledger"]
    po_payload = po_detail.json()
    export_payload = exported.json()
    actuals = sorted(
        (_project_actual(item) for item in ledger_payload["actuals"]),
        key=lambda item: item["source_type"],
    )
    projection = {
        "estimate": {
            key: estimate_payload[key]
            for key in (
                "original_estimate",
                "current_approved_estimate",
                "working_estimate",
                "actual",
                "remaining_planned",
                "forecast",
                "forecast_basis",
                "variance",
                "is_locked",
                "currency",
            )
        },
        "ledger": {
            "estimate_items": sorted(
                [
                    {
                        "category": item["category"],
                        "estimated_amount": item["estimated_amount"],
                        "actual_amount": item["actual_amount"],
                        "external_cost": item["external_cost"],
                    }
                    for item in ledger_payload["estimate_items"]
                ],
                key=lambda item: item["category"],
            ),
            "actuals": actuals,
            "unallocated_actual_count": len(ledger_payload["unallocated_actuals"]),
        },
        "vendor_purchase_order": {
            key: po_payload[key]
            for key in (
                "authorised_amount",
                "committed_amount",
                "actual_invoiced_amount",
                "open_commitment_amount",
                "remaining_amount",
            )
        },
        "invoice": {
            "status": export_payload["invoice"]["status"],
            "subtotal_amount": export_payload["invoice"]["subtotal_amount"],
            "tax_amount": export_payload["invoice"]["tax_amount"],
            "total_amount": export_payload["invoice"]["total_amount"],
            "currency": export_payload["invoice"]["currency"],
            "item_count": len(export_payload["items"]),
            "item_amount": export_payload["items"][0]["amount"],
            "exportable": export_readiness.json()["exportable"],
        },
    }
    assert projection == _expected()
