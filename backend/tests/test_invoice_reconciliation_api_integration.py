"""End-to-end financial lifecycle and reconciliation-gate coverage.

These tests intentionally use non-round values. They exercise the live
PostgreSQL ledger rather than inspecting client-side totals.
"""

from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Financial lifecycle integration tests run in CI against migrated PostgreSQL.",
)


def money(value: object) -> Decimal:
    return Decimal(str(value))


def episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def make_vendor(lab: ProductionApiLab) -> str:
    vendor_id = str(uuid4())
    lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, $3, 'vendor')",
        vendor_id,
        lab.data.organization_id,
        f"Lifecycle Supplier {vendor_id[:8]}",
    )
    return vendor_id


def configure_invoice_profile(lab: ProductionApiLab, current_episode_id: str) -> None:
    lab.execute(
        "UPDATE episodes SET workflow_status = 'complete' WHERE organization_id = $1 AND id = $2",
        lab.data.organization_id,
        current_episode_id,
    )
    lab.execute(
        """
        INSERT INTO invoice_settings (
          id, organization_id, legal_name, legal_address, billing_email,
          tax_enabled, tax_name, tax_rate_percent, payment_terms_days
        ) VALUES ($1, $2, 'Penny Post Ltd', '1 Ledger Way, London', 'billing@penny.test', true, 'VAT', 20, 30)
        """,
        str(uuid4()),
        lab.data.organization_id,
    )


def active_client_po(lab: ProductionApiLab, current_episode_id: str, amount: Decimal) -> str:
    created = lab.client.post(
        "/v1/client-purchase-orders",
        json={
            "client_company_id": lab.data.client_company_id,
            "show_id": lab.data.show_id,
            "episode_id": current_episode_id,
            "po_number": f"LIFECYCLE-CLIENT-{uuid4().hex[:8].upper()}",
            "approved_amount": str(amount),
        },
    )
    assert created.status_code == 201, created.text
    po_id = created.json()["id"]
    activated = lab.client.patch(f"/v1/client-purchase-orders/{po_id}", json={"status": "active"})
    assert activated.status_code == 200, activated.text
    return po_id


def create_rate_backed_estimate(lab: ProductionApiLab, current_episode_id: str) -> tuple[str, str]:
    service = lab.client.post(
        "/v1/rate-cards/services",
        json={
            "name": f"Lifecycle editorial hour {uuid4().hex[:8]}",
            "category": "Editorial",
            "unit": "hour",
            "rate": "127.37",
        },
    )
    assert service.status_code == 201, service.text
    service_id = service.json()["id"]
    estimate = lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": current_episode_id,
            "category": "Editorial",
            "description": "Fractional editorial finish",
            "planned_quantity": "2.75",
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": service_id,
        },
    )
    assert estimate.status_code == 201, estimate.text
    assert money(estimate.json()["estimated_amount"]) == Decimal("350.27")
    return service_id, estimate.json()["id"]


def create_confirmed_booking(lab: ProductionApiLab, current_episode_id: str, budget_line_id: str) -> str:
    created = lab.client.post(
        "/v1/bookings",
        json={
            "title": "Fractional editorial finish",
            "episode_id": current_episode_id,
            "room_id": lab.data.room_id,
            "person_id": lab.data.manager_person_id,
            "budget_line_id": budget_line_id,
            "starts_at": "2035-07-10T09:00:00Z",
            "ends_at": "2035-07-10T11:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def approve_client_change(
    lab: ProductionApiLab, current_episode_id: str, booking_id: str, client_po_id: str
) -> str:
    created = lab.client.post(
        "/v1/work-orders",
        json={
            "episode_id": current_episode_id,
            "workflow_stage_id": lab.data.workflow_stage_id,
            "booking_id": booking_id,
            "title": "Client editorial change",
            "work_type": "internal",
            "billing_scope": "billable_change",
            "client_purchase_order_id": client_po_id,
            "client_quote_amount": "19.99",
        },
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    assert lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"}).status_code == 200
    approved = lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"status": "in_progress", "approval_note": "Commercial change confirmed."},
    )
    assert approved.status_code == 200, approved.text
    completed = lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "complete"})
    assert completed.status_code == 200, completed.text
    return work_order_id


def test_full_invoice_lifecycle_reconciles_every_live_ledger_to_the_penny(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    current_episode_id = episode_id(production_lab)
    service_id, budget_line_id = create_rate_backed_estimate(production_lab, current_episode_id)
    approved_estimate = production_lab.client.post(
        f"/v1/budget/episodes/{current_episode_id}/estimate-revisions",
        json={"name": "Lifecycle baseline", "reason": "Freeze rate-card estimate.", "approve_immediately": True},
    )
    assert approved_estimate.status_code == 201, approved_estimate.text

    # A later rate-card change must not modify the frozen estimate or its line snapshot.
    changed_rate = production_lab.client.patch(f"/v1/rate-cards/services/{service_id}", json={"rate": "999.99"})
    assert changed_rate.status_code == 200, changed_rate.text
    saved_line = production_lab.fetchrow(
        "SELECT rate_snapshot::text, budgeted_amount::text FROM budget_lines WHERE id = $1", budget_line_id
    )
    assert saved_line and dict(saved_line) == {"rate_snapshot": "127.37", "budgeted_amount": "350.27"}
    open_revision = production_lab.client.post(
        f"/v1/budget/episodes/{current_episode_id}/estimate-revisions",
        json={"name": "Lifecycle vendor revision", "reason": "Add approved external finishing scope."},
    )
    assert open_revision.status_code == 201, open_revision.text

    booking_id = create_confirmed_booking(production_lab, current_episode_id, budget_line_id)
    actual = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-07-10T09:00:00Z",
            "actual_ends_at": "2035-07-10T11:00:00Z",
            "overtime_minutes": 45,
            "note": "1.25 hours approved overtime.",
        },
    )
    assert actual.status_code == 201, actual.text
    assert money(actual.json()["cost"]["actual_hours"]) == Decimal("2.75")
    assert production_lab.fetchval(
        "SELECT amount::text FROM budget_actual_allocations WHERE organization_id = $1 AND booking_id = $2",
        production_lab.data.organization_id,
        booking_id,
    ) == "350.27"

    # Moving the planned window afterwards cannot duplicate or alter confirmed actuals.
    moved_booking = production_lab.client.patch(
        f"/v1/bookings/{booking_id}",
        json={
            "title": "Fractional editorial finish",
            "episode_id": current_episode_id,
            "room_id": production_lab.data.room_id,
            "person_id": production_lab.data.manager_person_id,
            "budget_line_id": budget_line_id,
            "starts_at": "2035-07-10T12:00:00Z",
            "ends_at": "2035-07-10T14:00:00Z",
            "booking_type": "edit",
            "status": "confirmed",
        },
    )
    assert moved_booking.status_code == 200, moved_booking.text
    booking_actuals = production_lab.fetchrow(
        """
        SELECT count(*)::int AS count, sum(amount)::text AS total
        FROM budget_actual_allocations
        WHERE organization_id = $1 AND booking_id = $2
        """,
        production_lab.data.organization_id,
        booking_id,
    )
    assert booking_actuals and dict(booking_actuals) == {"count": 1, "total": "350.27"}

    vendor_id = make_vendor(production_lab)
    vendor_po = production_lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": production_lab.data.show_id,
            "episode_id": current_episode_id,
            "po_number": f"LIFECYCLE-VENDOR-{uuid4().hex[:8].upper()}",
            "approved_amount": "1250.00",
        },
    )
    assert vendor_po.status_code == 201, vendor_po.text
    vendor_po_id = vendor_po.json()["id"]
    assert production_lab.client.patch(f"/v1/purchase-orders/{vendor_po_id}", json={"status": "approved"}).status_code == 200
    vendor_budget = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": current_episode_id,
            "category": "External colour",
            "external_cost": True,
            "budgeted_amount": "1250.00",
        },
    )
    assert vendor_budget.status_code == 201, vendor_budget.text
    vendor_budget_id = vendor_budget.json()["id"]
    first_invoice = {
        "budget_line_id": vendor_budget_id,
        "invoice_number": f"LIFECYCLE-SUP-A-{uuid4().hex[:8].upper()}",
        "invoice_date": "2035-07-10",
        "amount": "833.33",
        "description": "First partial colour invoice",
    }
    first = production_lab.client.post(f"/v1/purchase-orders/{vendor_po_id}/actual-costs", json=first_invoice)
    retry_first = production_lab.client.post(f"/v1/purchase-orders/{vendor_po_id}/actual-costs", json=first_invoice)
    second = production_lab.client.post(
        f"/v1/purchase-orders/{vendor_po_id}/actual-costs",
        json={**first_invoice, "invoice_number": f"LIFECYCLE-SUP-B-{uuid4().hex[:8].upper()}", "amount": "416.67"},
    )
    assert first.status_code == second.status_code == 201
    assert retry_first.status_code == 409
    po_detail = production_lab.client.get(f"/v1/purchase-orders/{vendor_po_id}")
    assert po_detail.status_code == 200
    assert money(po_detail.json()["actual_invoiced_amount"]) == Decimal("1250.00")
    assert money(po_detail.json()["remaining_amount"]) == Decimal("0.00")
    assert len([item for item in po_detail.json()["allocations"] if item["allocation_type"] == "vendor_invoice"]) == 2

    client_po_id = active_client_po(production_lab, current_episode_id, Decimal("19.99"))
    work_order_id = approve_client_change(production_lab, current_episode_id, booking_id, client_po_id)
    billable = production_lab.client.post(
        f"/v1/billing/work-orders/{work_order_id}/billables", json={"reference": "LIFECYCLE-CHANGE"}
    )
    duplicate_billable = production_lab.client.post(f"/v1/billing/work-orders/{work_order_id}/billables", json={})
    assert billable.status_code == 201, billable.text
    assert duplicate_billable.status_code == 409
    assert money(billable.json()["amount"]) == Decimal("19.99")

    configure_invoice_profile(production_lab, current_episode_id)
    issued = production_lab.client.post("/v1/billing/invoices", json={"episode_id": current_episode_id})
    retry_invoice = production_lab.client.post("/v1/billing/invoices", json={"episode_id": current_episode_id})
    assert issued.status_code == 201, issued.text
    assert retry_invoice.status_code == 409
    assert (money(issued.json()["subtotal_amount"]), money(issued.json()["tax_amount"]), money(issued.json()["total_amount"])) == (
        Decimal("19.99"),
        Decimal("4.00"),
        Decimal("23.99"),
    )

    invoice_id = issued.json()["id"]
    gate = production_lab.client.get(f"/v1/billing/invoices/{invoice_id}/export-readiness")
    exported = production_lab.client.get(f"/v1/billing/invoices/{invoice_id}/export")
    assert gate.status_code == exported.status_code == 200
    assert gate.json()["exportable"] is True
    assert all(gate.json()["checks"].values())
    assert gate.json()["blockingReasons"] == []
    payload = exported.json()
    assert len(payload["items"]) == 1
    assert money(payload["items"][0]["amount"]) == Decimal("19.99")
    assert money(payload["invoice"]["subtotal_amount"]) + money(payload["invoice"]["tax_amount"]) == money(
        payload["invoice"]["total_amount"]
    )
    assert production_lab.fetchval(
        "SELECT count(*) FROM client_invoice_items WHERE organization_id = $1 AND client_invoice_id = $2",
        production_lab.data.organization_id,
        invoice_id,
    ) == 1


def test_vendor_invoice_correction_and_billable_void_reconcile_without_duplicate_rows(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    current_episode_id = episode_id(production_lab)
    vendor_id = make_vendor(production_lab)
    po = production_lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": production_lab.data.show_id,
            "episode_id": current_episode_id,
            "po_number": f"CORRECT-{uuid4().hex[:8].upper()}",
            "approved_amount": "1000.00",
        },
    )
    assert po.status_code == 201
    po_id = po.json()["id"]
    assert production_lab.client.patch(f"/v1/purchase-orders/{po_id}", json={"status": "approved"}).status_code == 200
    line = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": current_episode_id, "category": "Vendor VFX", "external_cost": True, "budgeted_amount": "1000.00"},
    )
    assert line.status_code == 201
    recorded = production_lab.client.post(
        f"/v1/purchase-orders/{po_id}/actual-costs",
        json={
            "budget_line_id": line.json()["id"],
            "invoice_number": f"CORRECT-INV-{uuid4().hex[:8].upper()}",
            "invoice_date": "2035-07-10",
            "amount": "833.33",
            "description": "Initial VFX supplier invoice",
        },
    )
    assert recorded.status_code == 201, recorded.text
    approved_supplier_invoice = production_lab.client.patch(
        f"/v1/vendor-invoices/{recorded.json()['invoice_id']}", json={"status": "approved"}
    )
    assert approved_supplier_invoice.status_code == 200, approved_supplier_invoice.text
    corrected = production_lab.client.patch(
        f"/v1/vendor-invoices/{recorded.json()['invoice_id']}",
        json={"amount": "800.00", "description": "Corrected VFX supplier invoice"},
    )
    assert corrected.status_code == 200, corrected.text
    counts = production_lab.fetchrow(
        """
        SELECT
          (SELECT count(*)::int FROM budget_actual_allocations WHERE organization_id = $1 AND vendor_invoice_id = $2) AS actual_count,
          (SELECT count(*)::int FROM purchase_order_allocations WHERE organization_id = $1 AND vendor_invoice_id = $2) AS po_count,
          (SELECT amount::text FROM budget_actual_allocations WHERE organization_id = $1 AND vendor_invoice_id = $2) AS actual_amount
        """,
        production_lab.data.organization_id,
        recorded.json()["invoice_id"],
    )
    assert counts and dict(counts) == {"actual_count": 1, "po_count": 1, "actual_amount": "800.00"}

    client_po_id = active_client_po(production_lab, current_episode_id, Decimal("19.99"))
    booking_id = create_confirmed_booking(production_lab, current_episode_id, None)
    confirmed_time = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-07-10T09:00:00Z",
            "actual_ends_at": "2035-07-10T11:00:00Z",
            "overtime_minutes": 0,
        },
    )
    assert confirmed_time.status_code == 201, confirmed_time.text
    work_order_id = approve_client_change(production_lab, current_episode_id, booking_id, client_po_id)
    posted = production_lab.client.post(f"/v1/billing/work-orders/{work_order_id}/billables", json={})
    assert posted.status_code == 201, posted.text
    voided = production_lab.client.post(
        f"/v1/billing/billables/{posted.json()['id']}/void", json={"reason": "Client withdrew the requested change."}
    )
    retry_void = production_lab.client.post(
        f"/v1/billing/billables/{posted.json()['id']}/void", json={"reason": "Client withdrew the requested change."}
    )
    assert voided.status_code == 200, voided.text
    assert retry_void.status_code == 200
    assert voided.json()["status"] == "void"
    readiness = production_lab.client.get(f"/v1/billing/episodes/{current_episode_id}/readiness")
    assert readiness.status_code == 200
    assert readiness.json()["ready_to_issue"] is False
    remaining_commitment = production_lab.fetchval(
        "SELECT count(*) FROM client_purchase_order_allocations WHERE organization_id = $1 AND client_purchase_order_id = $2",
        production_lab.data.organization_id,
        client_po_id,
    )
    assert remaining_commitment == 0


def test_export_reconciliation_blocks_tampered_source_and_cross_tenant_ids(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    current_episode_id = episode_id(production_lab)
    client_po_id = active_client_po(production_lab, current_episode_id, Decimal("19.99"))
    booking_id = create_confirmed_booking(production_lab, current_episode_id, None)
    confirmed_time = production_lab.client.post(
        f"/v1/bookings/{booking_id}/time-submissions",
        json={
            "actual_starts_at": "2035-07-10T09:00:00Z",
            "actual_ends_at": "2035-07-10T11:00:00Z",
            "overtime_minutes": 0,
        },
    )
    assert confirmed_time.status_code == 201, confirmed_time.text
    work_order_id = approve_client_change(production_lab, current_episode_id, booking_id, client_po_id)
    posted = production_lab.client.post(f"/v1/billing/work-orders/{work_order_id}/billables", json={})
    assert posted.status_code == 201
    configure_invoice_profile(production_lab, current_episode_id)
    issued = production_lab.client.post("/v1/billing/invoices", json={"episode_id": current_episode_id})
    assert issued.status_code == 201
    invoice_id = issued.json()["id"]

    production_lab.execute(
        """
        UPDATE client_invoice_items
        SET quantity = 2, unit_amount = 9.99, amount = 19.98
        WHERE organization_id = $1 AND client_invoice_id = $2
        """,
        production_lab.data.organization_id,
        invoice_id,
    )
    gate = production_lab.client.get(f"/v1/billing/invoices/{invoice_id}/export-readiness")
    blocked_export = production_lab.client.get(f"/v1/billing/invoices/{invoice_id}/export")
    assert gate.status_code == 200
    assert gate.json()["exportable"] is False
    assert gate.json()["checks"]["invoiceLinesEqualSourceBillables"] is False
    assert gate.json()["checks"]["totalsReconcile"] is False
    assert blocked_export.status_code == 409

    foreign_invoice = production_lab.client.get(f"/v1/billing/invoices/{uuid4()}/export-readiness")
    foreign_episode = production_lab.client.post("/v1/billing/invoices", json={"episode_id": production_lab.data.foreign_episode_id})
    assert foreign_invoice.status_code == foreign_episode.status_code == 404


def test_moving_uninvoiced_vendor_work_rehomes_its_single_commitment_once(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    old_episode_id = episode_id(production_lab)
    new_episode_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO episodes (
          id, organization_id, season_id, workflow_stage_id, number, production_code,
          title, status, workflow_status, qc_status
        ) VALUES ($1, $2, $3, $4, 2, 'PYS102', 'Moved-work episode', 'development', 'not_started', 'not_started')
        """,
        new_episode_id,
        production_lab.data.organization_id,
        production_lab.data.season_id,
        production_lab.data.workflow_stage_id,
    )
    vendor_id = make_vendor(production_lab)
    po = production_lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": production_lab.data.show_id,
            "po_number": f"MOVE-WORK-{uuid4().hex[:8].upper()}",
            "approved_amount": "1000.00",
        },
    )
    assert po.status_code == 201, po.text
    po_id = po.json()["id"]
    assert production_lab.client.patch(f"/v1/purchase-orders/{po_id}", json={"status": "approved"}).status_code == 200
    old_line = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": old_episode_id, "category": "External VFX", "external_cost": True, "budgeted_amount": "100.00"},
    )
    new_line = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": new_episode_id, "category": "External VFX", "external_cost": True, "budgeted_amount": "100.00"},
    )
    assert old_line.status_code == new_line.status_code == 201
    work_order = production_lab.client.post(
        "/v1/work-orders",
        json={
            "episode_id": old_episode_id,
            "workflow_stage_id": production_lab.data.workflow_stage_id,
            "title": "Moveable vendor VFX task",
            "work_type": "external_vendor",
            "vendor_company_id": vendor_id,
            "purchase_order_id": po_id,
            "budget_line_id": old_line.json()["id"],
            "estimated_amount": "100.00",
        },
    )
    assert work_order.status_code == 201, work_order.text
    work_order_id = work_order.json()["id"]
    assert production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"}).status_code == 200
    approved = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"status": "in_progress", "approval_note": "Vendor scope approved."}
    )
    assert approved.status_code == 200, approved.text

    moved = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"episode_id": new_episode_id, "budget_line_id": new_line.json()["id"]},
    )
    foreign_move = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"episode_id": production_lab.data.foreign_episode_id, "budget_line_id": new_line.json()["id"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["episode_id"] == new_episode_id
    assert foreign_move.status_code == 404
    commitment = production_lab.fetchrow(
        """
        SELECT count(*)::int AS count, sum(amount)::text AS amount
        FROM purchase_order_allocations
        WHERE organization_id = $1 AND purchase_order_id = $2 AND work_order_id = $3
        """,
        production_lab.data.organization_id,
        po_id,
        work_order_id,
    )
    assert commitment and dict(commitment) == {"count": 1, "amount": "100.00"}
