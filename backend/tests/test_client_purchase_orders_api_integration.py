"""Client PO FastAPI foundations: tenant scope, lifecycle, balances, and ledger."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Client-PO FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _payload(lab: ProductionApiLab, **overrides: object) -> dict[str, object]:
    return {
        "client_company_id": lab.data.client_company_id,
        "show_id": lab.data.show_id,
        "episode_id": _episode_id(lab),
        "po_number": f"PY-CLIENT-{uuid4().hex[:8].upper()}",
        "approved_amount": 1_000,
        "issue_date": "2035-06-01",
        "expiry_date": "2035-08-01",
        "notes": "Client billing authorisation for finishing changes.",
        **overrides,
    }


def _create_draft(lab: ProductionApiLab, **overrides: object) -> dict[str, object]:
    response = lab.client.post("/v1/client-purchase-orders", json=_payload(lab, **overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_client_po_register_lifecycle_live_balances_ledger_and_audit(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    draft = _create_draft(production_lab)
    client_purchase_order_id = draft["id"]
    activated = production_lab.client.patch(
        f"/v1/client-purchase-orders/{client_purchase_order_id}", json={"status": "active"}
    )
    assert activated.status_code == 200, activated.text

    production_lab.execute(
        """
        INSERT INTO client_purchase_order_allocations (
          id, organization_id, client_purchase_order_id, allocation_type,
          change_order_reference, amount, overrun_authorised, allocation_date, reference, description
        ) VALUES ($1, $2, $3, 'change_order', 'CO-PY-001', 400, false, '2035-06-10', 'CO-PY-001', 'Extra colour pass')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        client_purchase_order_id,
    )
    invoice_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO client_invoices (
          id, organization_id, sequence, invoice_number, client_company_id, show_id, episode_id, status,
          invoice_date, due_date, currency, subtotal_amount, tax_name, tax_rate_percent, tax_amount,
          total_amount, issuer_name, client_name
        ) VALUES (
          $1, $2, 901, $3, $4, $5, $6, 'issued',
          '2035-06-11', '2035-07-11', 'GBP', 250, 'VAT', 0, 0, 250, 'Python Post', 'Python Network'
        )
        """,
        invoice_id,
        production_lab.data.organization_id,
        f"PY-INV-{uuid4().hex[:8].upper()}",
        production_lab.data.client_company_id,
        production_lab.data.show_id,
        _episode_id(production_lab),
    )
    production_lab.execute(
        """
        INSERT INTO client_purchase_order_allocations (
          id, organization_id, client_purchase_order_id, allocation_type,
          client_invoice_id, amount, overrun_authorised, allocation_date, reference, description
        ) VALUES ($1, $2, $3, 'client_invoice', $4, 250, false, '2035-06-11', 'PY-INV', 'Issued client invoice')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        client_purchase_order_id,
        invoice_id,
    )

    detail = production_lab.client.get(f"/v1/client-purchase-orders/{client_purchase_order_id}")
    register = production_lab.client.get("/v1/client-purchase-orders")
    assert detail.status_code == register.status_code == 200
    values = detail.json()
    assert values["status"] == "active"
    assert values["authorised_amount"] == 1_000
    assert values["committed_to_bill_amount"] == 400
    assert values["invoiced_amount"] == 250
    assert values["remaining_amount"] == 600
    assert values["variance_amount"] == -750
    assert {allocation["allocation_type"] for allocation in values["allocations"]} == {
        "change_order",
        "client_invoice",
    }
    assert {event["action"] for event in values["activity"]} >= {
        "client_purchase_order.created",
        "client_purchase_order.activated",
    }
    assert register.json()["client_purchase_orders"][0]["id"] == client_purchase_order_id


def test_client_po_only_allows_draft_edits_and_one_way_lifecycle(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    draft = _create_draft(production_lab)
    client_purchase_order_id = draft["id"]
    edited = production_lab.client.patch(
        f"/v1/client-purchase-orders/{client_purchase_order_id}",
        json={"notes": "Revised client authorisation."},
    )
    activated = production_lab.client.patch(
        f"/v1/client-purchase-orders/{client_purchase_order_id}", json={"status": "active"}
    )
    late_edit = production_lab.client.patch(
        f"/v1/client-purchase-orders/{client_purchase_order_id}", json={"notes": "No longer editable"}
    )
    closed = production_lab.client.patch(
        f"/v1/client-purchase-orders/{client_purchase_order_id}", json={"status": "closed"}
    )
    reopened = production_lab.client.patch(
        f"/v1/client-purchase-orders/{client_purchase_order_id}", json={"status": "active"}
    )

    assert edited.status_code == activated.status_code == closed.status_code == 200
    assert late_edit.status_code == reopened.status_code == 409


def test_client_po_validates_client_show_episode_scope_and_hides_foreign_records(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = str(uuid4())
    other_client_id = str(uuid4())
    foreign_client_po_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Python supplier', 'vendor')",
        vendor_id,
        production_lab.data.organization_id,
    )
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Other Python client', 'client')",
        other_client_id,
        production_lab.data.organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO client_purchase_orders (
          id, organization_id, client_company_id, po_number, currency, approved_amount, status
        ) VALUES ($1, $2, $3, 'FOREIGN-CLIENT-PO-001', 'GBP', 1000, 'active')
        """,
        foreign_client_po_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_company_id,
    )
    vendor = production_lab.client.post(
        "/v1/client-purchase-orders", json=_payload(production_lab, client_company_id=vendor_id)
    )
    mismatched_client = production_lab.client.post(
        "/v1/client-purchase-orders", json=_payload(production_lab, client_company_id=other_client_id)
    )
    foreign_client = production_lab.client.post(
        "/v1/client-purchase-orders",
        json=_payload(production_lab, client_company_id=production_lab.data.foreign_company_id),
    )
    foreign_show = production_lab.client.post(
        "/v1/client-purchase-orders", json=_payload(production_lab, show_id=production_lab.data.foreign_show_id)
    )
    foreign_read = production_lab.client.get(f"/v1/client-purchase-orders/{foreign_client_po_id}")
    foreign_update = production_lab.client.patch(
        f"/v1/client-purchase-orders/{foreign_client_po_id}", json={"status": "closed"}
    )

    assert vendor.status_code == 400
    assert mismatched_client.status_code == 409
    assert (
        foreign_client.status_code
        == foreign_show.status_code
        == foreign_read.status_code
        == foreign_update.status_code
        == 404
    )


def test_client_po_requires_commercial_capability_and_enforces_per_tenant_po_numbers(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    po_number = f"PY-CLIENT-{uuid4().hex[:8].upper()}"
    vendor_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Separate PO vendor', 'vendor')",
        vendor_id,
        production_lab.data.organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO purchase_orders (
          id, organization_id, vendor_company_id, po_number, currency, approved_amount, status
        ) VALUES ($1, $2, $3, $4, 'GBP', 1000, 'approved')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        vendor_id,
        po_number,
    )
    client_order = _create_draft(production_lab, po_number=po_number)
    duplicate = production_lab.client.post(
        "/v1/client-purchase-orders", json=_payload(production_lab, po_number=po_number)
    )
    register = production_lab.client.get("/v1/client-purchase-orders")
    assert register.status_code == 200
    assert [order["id"] for order in register.json()["client_purchase_orders"]] == [client_order["id"]]
    assert duplicate.status_code == 409

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/client-purchase-orders").status_code == 403
    assert (
        production_lab.client.post(
            "/v1/client-purchase-orders",
            json={
                "client_company_id": production_lab.data.client_company_id,
                "po_number": "VIEWER-PO",
                "approved_amount": 100,
            },
        ).status_code
        == 403
    )


def test_work_order_client_po_selector_returns_only_active_unexpired_episode_scope(
    production_lab: ProductionApiLab,
) -> None:
    """Client-billable work only receives authorisations valid for its episode."""
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    matching = _create_draft(production_lab)
    global_scope = _create_draft(production_lab, show_id=None, episode_id=None)
    expired = _create_draft(production_lab, issue_date="2019-01-01", expiry_date="2020-01-01")
    other_episode = str(uuid4())
    season_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO seasons (id, organization_id, show_id, number) VALUES ($1, $2, $3, 77)",
        season_id,
        production_lab.data.organization_id,
        production_lab.data.show_id,
    )
    production_lab.execute(
        """
        INSERT INTO episodes (id, organization_id, season_id, number, title, status, workflow_status, qc_status)
        VALUES ($1, $2, $3, 77, 'Client PO selector alternate', 'development', 'not_started', 'not_started')
        """,
        other_episode,
        production_lab.data.organization_id,
        season_id,
    )
    wrong_episode = _create_draft(production_lab, episode_id=other_episode)
    for created in (matching, global_scope, expired, wrong_episode):
        assert (
            production_lab.client.patch(
                f"/v1/client-purchase-orders/{created['id']}", json={"status": "active"}
            ).status_code
            == 200
        )

    selected = production_lab.client.get(f"/v1/client-purchase-orders?episodeId={episode_id}")
    assert selected.status_code == 200, selected.text
    assert {item["id"] for item in selected.json()["client_purchase_orders"]} == {
        matching["id"],
        global_scope["id"],
    }
