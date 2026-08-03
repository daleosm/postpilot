"""Database-backed penny tests for ledger equations and idempotency."""

from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Financial invariant integration tests run in CI against migrated PostgreSQL.",
)


def _money(value: object) -> Decimal:
    return Decimal(str(value))


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _vendor(lab: ProductionApiLab) -> str:
    vendor_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO crm_companies (id, organization_id, name, type)
        VALUES ($1, $2, 'Penny Test Supplier', 'vendor')
        """,
        vendor_id,
        lab.data.organization_id,
    )
    return vendor_id


def test_estimate_overview_obeys_actual_forecast_and_variance_equations(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    created = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": episode_id, "category": "Penny-test online", "budgeted_amount": "100.01"},
    )
    assert created.status_code == 201, created.text
    line_id = created.json()["id"]
    approved = production_lab.client.post(
        f"/v1/budget/episodes/{episode_id}/estimate-revisions",
        json={"name": "Penny baseline", "reason": "Freeze the awkward-value estimate.", "approve_immediately": True},
    )
    assert approved.status_code == 201, approved.text
    actual = production_lab.client.post(
        f"/v1/budget/lines/{line_id}/manual-actual-adjustments",
        json={"amount": "33.33", "reason": "Confirmed finishing actual."},
    )
    assert actual.status_code == 201, actual.text

    overview_response = production_lab.client.get(f"/v1/budget/episodes/{episode_id}/estimate-overview")
    assert overview_response.status_code == 200, overview_response.text
    overview = overview_response.json()["estimate"]
    approved_estimate = _money(overview["current_approved_estimate"])
    recorded_actual = _money(overview["actual"])
    remaining_planned = _money(overview["remaining_planned"])
    forecast = _money(overview["forecast"])
    variance = _money(overview["variance"])

    assert approved_estimate == Decimal("100.01")
    assert recorded_actual == Decimal("33.33")
    assert forecast == recorded_actual + remaining_planned
    assert variance == forecast - approved_estimate
    assert (remaining_planned, forecast, variance) == (Decimal("66.68"), Decimal("100.01"), Decimal("0.00"))


def test_vendor_po_invoice_retries_remain_single_and_reduce_remaining_authorisation(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    vendor_id = _vendor(production_lab)
    po = production_lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": production_lab.data.show_id,
            "episode_id": episode_id,
            "po_number": f"PENNY-VENDOR-{uuid4().hex[:8].upper()}",
            "approved_amount": "1000.00",
        },
    )
    assert po.status_code == 201, po.text
    po_id = po.json()["id"]
    assert production_lab.client.patch(f"/v1/purchase-orders/{po_id}", json={"status": "approved"}).status_code == 200
    budget_line = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Penny supplier grade",
            "external_cost": True,
            "budgeted_amount": "333.33",
        },
    )
    assert budget_line.status_code == 201, budget_line.text
    body = {
        "budget_line_id": budget_line.json()["id"],
        "invoice_number": "PENNY-SUPPLIER-001",
        "invoice_date": "2035-07-10",
        "amount": "333.33",
        "description": "Supplier colour actual.",
    }
    recorded = production_lab.client.post(f"/v1/purchase-orders/{po_id}/actual-costs", json=body)
    retried = production_lab.client.post(f"/v1/purchase-orders/{po_id}/actual-costs", json=body)

    assert recorded.status_code == 201, recorded.text
    assert retried.status_code == 409
    detail = production_lab.client.get(f"/v1/purchase-orders/{po_id}")
    assert detail.status_code == 200, detail.text
    values = detail.json()
    authorised = _money(values["authorised_amount"])
    commitments = _money(values["committed_amount"])
    actuals = _money(values["actual_invoiced_amount"])
    open_commitments = _money(values["open_commitment_amount"])
    remaining = _money(values["remaining_amount"])

    assert actuals == Decimal("333.33")
    assert remaining == authorised - open_commitments - actuals
    assert (commitments, open_commitments, remaining) == (Decimal("0.00"), Decimal("0.00"), Decimal("666.67"))
    assert len([row for row in values["allocations"] if row["allocation_type"] == "vendor_invoice"]) == 1


def test_client_po_ledger_reconciles_committed_and_invoiced_values_to_the_penny(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    po = production_lab.client.post(
        "/v1/client-purchase-orders",
        json={
            "client_company_id": production_lab.data.client_company_id,
            "show_id": production_lab.data.show_id,
            "episode_id": episode_id,
            "po_number": f"PENNY-CLIENT-{uuid4().hex[:8].upper()}",
            "approved_amount": "1000.00",
        },
    )
    assert po.status_code == 201, po.text
    po_id = po.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/client-purchase-orders/{po_id}", json={"status": "active"}).status_code == 200
    )

    invoice_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO client_invoices (
          id, organization_id, sequence, invoice_number, client_company_id, show_id, episode_id, status,
          invoice_date, due_date, currency, subtotal_amount, tax_enabled, tax_name, tax_rate_percent,
          tax_amount, total_amount, issuer_name, client_name
        ) VALUES (
          $1, $2, 990, $3, $4, $5, $6, 'issued',
          '2035-07-11', '2035-08-10', 'GBP', 250.02, false, 'VAT', 0, 0, 250.02, 'Penny Test Post', 'Penny Client'
        )
        """,
        invoice_id,
        production_lab.data.organization_id,
        f"PENNY-INV-{uuid4().hex[:8].upper()}",
        production_lab.data.client_company_id,
        production_lab.data.show_id,
        episode_id,
    )
    production_lab.execute(
        """
        INSERT INTO client_purchase_order_allocations (
          id, organization_id, client_purchase_order_id, allocation_type,
          change_order_reference, amount, overrun_authorised, allocation_date
        ) VALUES ($1, $2, $3, 'change_order', 'PENNY-CO-001', 600.01, false, '2035-07-10')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        po_id,
    )
    production_lab.execute(
        """
        INSERT INTO client_purchase_order_allocations (
          id, organization_id, client_purchase_order_id, allocation_type,
          client_invoice_id, amount, overrun_authorised, allocation_date
        ) VALUES ($1, $2, $3, 'client_invoice', $4, 250.02, false, '2035-07-11')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        po_id,
        invoice_id,
    )
    detail = production_lab.client.get(f"/v1/client-purchase-orders/{po_id}")
    assert detail.status_code == 200, detail.text
    values = detail.json()
    authorised = _money(values["authorised_amount"])
    commitments = _money(values["committed_to_bill_amount"])
    invoiced = _money(values["invoiced_amount"])
    open_commitments = _money(values["open_billable_commitment_amount"])
    remaining = _money(values["remaining_amount"])

    assert remaining == authorised - open_commitments - invoiced
    assert (commitments, invoiced, open_commitments, remaining) == (
        Decimal("600.01"),
        Decimal("250.02"),
        Decimal("349.99"),
        Decimal("399.99"),
    )
