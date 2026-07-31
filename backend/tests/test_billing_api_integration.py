"""FastAPI billable and invoice-readiness coverage against isolated tenants."""

from __future__ import annotations

import json
import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Billing FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _configure_second_manager(lab: ProductionApiLab) -> None:
    lab.execute(
        """
        UPDATE organization_role_policies SET permissions = $1::jsonb
        WHERE organization_id = $2 AND role = 'production_viewer'
        """,
        json.dumps(["manage_production", "manage_commercial"]),
        lab.data.organization_id,
    )


def _active_client_po(lab: ProductionApiLab, *, amount: int = 500) -> str:
    created = lab.client.post(
        "/v1/client-purchase-orders",
        json={
            "client_company_id": lab.data.client_company_id,
            "show_id": lab.data.show_id,
            "episode_id": _episode_id(lab),
            "po_number": f"PY-BILL-{uuid4().hex[:8].upper()}",
            "approved_amount": amount,
            "issue_date": "2035-06-01",
            "expiry_date": "2035-08-01",
        },
    )
    assert created.status_code == 201, created.text
    po_id = created.json()["id"]
    activated = lab.client.patch(f"/v1/client-purchase-orders/{po_id}", json={"status": "active"})
    assert activated.status_code == 200, activated.text
    return po_id


def _completed_billable_change(lab: ProductionApiLab, *, client_po_id: str, quote: int = 125) -> str:
    episode_id = _episode_id(lab)
    created = lab.client.post(
        "/v1/work-orders",
        json={
            "episode_id": episode_id,
            "workflow_stage_id": lab.data.workflow_stage_id,
            "title": "Approved client colour correction",
            "work_type": "internal",
            "billing_scope": "billable_change",
            "client_purchase_order_id": client_po_id,
            "client_quote_amount": quote,
        },
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    submitted = lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"})
    assert submitted.status_code == 200, submitted.text
    lab.sign_out()
    lab.sign_in_as_viewer()
    approved = lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"status": "in_progress", "approval_note": "Commercial scope confirmed."},
    )
    # Internal work is a real facility activity: the current product rule
    # requires a room reservation before it can be completed and invoiced.
    booking_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO bookings (
          id, organization_id, episode_id, room_id, person_id, title,
          starts_at, ends_at, setup_minutes, handover_minutes,
          approved_overtime_minutes, is_option, status, booking_type,
          actual_starts_at, actual_ends_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'Approved client colour correction',
          '2035-06-10 09:00:00+00', '2035-06-10 12:00:00+00',
          0, 0, 0, false, 'confirmed', 'color',
          '2035-06-10 09:00:00+00', '2035-06-10 12:00:00+00'
        )
        """,
        booking_id,
        lab.data.organization_id,
        episode_id,
        lab.data.room_id,
        lab.data.colorist_person_id,
    )
    lab.execute(
        "UPDATE post_work_orders SET booking_id = $1 WHERE organization_id = $2 AND id = $3",
        booking_id,
        lab.data.organization_id,
        work_order_id,
    )
    completed = lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "complete"})
    assert approved.status_code == completed.status_code == 200
    return work_order_id


def _set_invoice_readiness_prerequisites(lab: ProductionApiLab, episode_id: str) -> None:
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
        ) VALUES ($1, $2, 'Python Post Ltd', '1 Edit Street, London', 'billing@python.test', false, 'VAT', 0, 30)
        """,
        str(uuid4()),
        lab.data.organization_id,
    )


def test_posts_completed_client_change_and_issues_export_safe_invoice(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    _configure_second_manager(production_lab)
    client_po_id = _active_client_po(production_lab)
    work_order_id = _completed_billable_change(production_lab, client_po_id=client_po_id)

    posted = production_lab.client.post(
        f"/v1/billing/work-orders/{work_order_id}/billables", json={"reference": "COLOUR-101"}
    )
    duplicate = production_lab.client.post(f"/v1/billing/work-orders/{work_order_id}/billables", json={})
    assert posted.status_code == 201, posted.text
    assert duplicate.status_code == 409
    billable = posted.json()
    saved = production_lab.fetchrow(
        """
        SELECT allocation_type, billable_id::text, work_order_id::text
        FROM client_purchase_order_allocations
        WHERE organization_id = $1 AND client_purchase_order_id = $2
        """,
        production_lab.data.organization_id,
        client_po_id,
    )
    assert saved and dict(saved) == {
        "allocation_type": "billable",
        "billable_id": billable["id"],
        "work_order_id": None,
    }

    episode_id = _episode_id(production_lab)
    blocked = production_lab.client.get(f"/v1/billing/episodes/{episode_id}/readiness")
    assert blocked.status_code == 200
    assert blocked.json()["ready_to_issue"] is False
    assert "Complete the episode workflow" in blocked.json()["blocked_reason"]

    _set_invoice_readiness_prerequisites(production_lab, episode_id)
    ready = production_lab.client.get(f"/v1/billing/episodes/{episode_id}/readiness")
    assert ready.status_code == 200, ready.text
    assert ready.json()["ready_to_issue"] is True
    assert ready.json()["invoice_ready_total"] == 125

    issued = production_lab.client.post("/v1/billing/invoices", json={"episode_id": episode_id})
    assert issued.status_code == 201, issued.text
    invoice_id = issued.json()["id"]
    allocation = production_lab.fetchrow(
        """
        SELECT allocation_type, client_invoice_item_id::text, client_invoice_id::text
        FROM client_purchase_order_allocations
        WHERE organization_id = $1 AND client_purchase_order_id = $2 AND allocation_type = 'client_invoice'
        """,
        production_lab.data.organization_id,
        client_po_id,
    )
    assert allocation and allocation["client_invoice_item_id"] and allocation["client_invoice_id"] is None
    assert production_lab.fetchval("SELECT status FROM billables WHERE id = $1", billable["id"]) == "invoiced"
    assert production_lab.client.get(f"/v1/billing/invoices/{invoice_id}/export-readiness").json()["exportable"] is True
    exported = production_lab.client.get(f"/v1/billing/invoices/{invoice_id}/export")
    assert exported.status_code == 200, exported.text
    assert exported.json()["invoice"]["invoice_number"] == issued.json()["invoice_number"]


def test_invoice_readiness_requires_submitted_actual_time_and_tenant_scope(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    _configure_second_manager(production_lab)
    client_po_id = _active_client_po(production_lab)
    work_order_id = _completed_billable_change(production_lab, client_po_id=client_po_id)
    assert production_lab.client.post(f"/v1/billing/work-orders/{work_order_id}/billables", json={}).status_code == 201
    episode_id = _episode_id(production_lab)
    _set_invoice_readiness_prerequisites(production_lab, episode_id)
    booking_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO bookings (
          id, organization_id, episode_id, person_id, title, starts_at, ends_at,
          setup_minutes, handover_minutes, approved_overtime_minutes, is_option, status, booking_type
        ) VALUES (
          $1, $2, $3, $4, 'Client correction session',
          '2035-07-02 09:00:00+00', '2035-07-02 12:00:00+00',
          0, 0, 0, false, 'confirmed', 'color'
        )
        """,
        booking_id,
        production_lab.data.organization_id,
        episode_id,
        production_lab.data.colorist_person_id,
    )
    pending_time = production_lab.client.get(f"/v1/billing/episodes/{episode_id}/readiness")
    assert pending_time.status_code == 200
    assert pending_time.json()["ready_to_issue"] is False
    assert "actual time" in pending_time.json()["blocked_reason"]
    production_lab.execute(
        """
        UPDATE bookings SET actual_starts_at = '2035-07-02 09:00:00+00', actual_ends_at = '2035-07-02 12:00:00+00'
        WHERE organization_id = $1 AND id = $2
        """,
        production_lab.data.organization_id,
        booking_id,
    )
    assert production_lab.client.get(f"/v1/billing/episodes/{episode_id}/readiness").json()["ready_to_issue"] is True
    foreign_work_order_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, kind, title, priority,
          is_blocking, status, billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'internal', 'work_order', 'Foreign billed change', 'normal',
          false, 'complete', 'billable_change', 'draft', 'GBP'
        )
        """,
        foreign_work_order_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_episode_id,
    )
    foreign = production_lab.client.get(f"/v1/billing/episodes/{production_lab.data.foreign_episode_id}/readiness")
    foreign_work_order = production_lab.client.post(
        f"/v1/billing/work-orders/{foreign_work_order_id}/billables", json={}
    )
    assert foreign.status_code == foreign_work_order.status_code == 404
