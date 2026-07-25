"""Tenant, capability, contact-scope, and account-360 CRM API coverage."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="CRM FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _create_company(lab: ProductionApiLab, *, name: str, company_type: str) -> str:
    response = lab.client.post(
        "/v1/crm/companies",
        json={"name": name, "type": company_type, "finance_email": f"{uuid4().hex[:8]}@example.com"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_contact(lab: ProductionApiLab, *, company_id: str, name: str, contact_type: str) -> str:
    response = lab.client.post(
        "/v1/crm/contacts",
        json={
            "company_id": company_id,
            "name": name,
            "contact_type": contact_type,
            "email": f"{uuid4().hex[:8]}@example.com",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_crm_company_contact_and_show_contact_scope_are_tenant_safe(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    client_contact_id = _create_contact(
        production_lab,
        company_id=production_lab.data.client_company_id,
        name="Python creative approver",
        contact_type="creative_approval",
    )
    assigned = production_lab.client.post(
        f"/v1/crm/shows/{production_lab.data.show_id}/contacts",
        json={
            "contact_id": client_contact_id,
            "responsibility": "creative_approvals",
            "relationship": "Series creative approver",
            "is_approval_contact": True,
        },
    )
    assert assigned.status_code == 201, assigned.text
    assert production_lab.client.get(f"/v1/crm/shows/{production_lab.data.show_id}/contacts").status_code == 200

    vendor_id = _create_company(production_lab, name=f"Python vendor {uuid4().hex[:6]}", company_type="vendor")
    vendor_contact_id = _create_contact(
        production_lab,
        company_id=vendor_id,
        name="Python vendor contact",
        contact_type="general",
    )
    unrelated_client_id = _create_company(production_lab, name=f"Other client {uuid4().hex[:6]}", company_type="client")
    unrelated_contact_id = _create_contact(
        production_lab,
        company_id=unrelated_client_id,
        name="Other client approver",
        contact_type="creative_approval",
    )
    vendor_assignment = production_lab.client.post(
        f"/v1/crm/shows/{production_lab.data.show_id}/contacts",
        json={
            "contact_id": vendor_contact_id,
            "responsibility": "finance_billing",
            "relationship": "Supplier contact",
        },
    )
    unrelated_assignment = production_lab.client.post(
        f"/v1/crm/shows/{production_lab.data.show_id}/contacts",
        json={
            "contact_id": unrelated_contact_id,
            "responsibility": "legal_compliance",
            "relationship": "Other client contact",
        },
    )
    invalid_contact_edit = production_lab.client.patch(
        f"/v1/crm/contacts/{client_contact_id}", json={"contact_type": "finance"}
    )
    foreign_company = production_lab.client.get(f"/v1/crm/companies/{production_lab.data.foreign_company_id}")
    foreign_contact = production_lab.client.post(
        "/v1/crm/contacts",
        json={
            "company_id": production_lab.data.foreign_company_id,
            "name": "Foreign contact",
            "contact_type": "general",
        },
    )
    invalid_client_supplier_flag = production_lab.client.patch(
        f"/v1/crm/companies/{production_lab.data.client_company_id}", json={"is_preferred_supplier": True}
    )

    assert (
        vendor_assignment.status_code
        == unrelated_assignment.status_code
        == invalid_contact_edit.status_code
        == invalid_client_supplier_flag.status_code
        == 409
    )
    assert foreign_company.status_code == foreign_contact.status_code == 404

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/crm/companies").status_code == 403


def test_crm_account_views_use_live_ledgers_without_client_vendor_data_leakage(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    production_lab.execute(
        """
        INSERT INTO budget_lines (
          id, organization_id, show_id, category, budgeted_amount, actual_amount, currency
        ) VALUES ($1, $2, $3, 'Colour', 500, 175, 'GBP')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        production_lab.data.show_id,
    )
    production_lab.execute(
        """
        INSERT INTO billables (
          id, organization_id, show_id, episode_id, vendor, description, amount, currency, status
        ) VALUES ($1, $2, $3, $4, 'Python Network', 'Client colour change', 125, 'GBP', 'approved')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        production_lab.data.show_id,
        production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"],
    )
    client_po = production_lab.client.post(
        "/v1/client-purchase-orders",
        json={
            "client_company_id": production_lab.data.client_company_id,
            "show_id": production_lab.data.show_id,
            "po_number": f"CRM-CLIENT-{uuid4().hex[:8]}",
            "approved_amount": 1_000,
        },
    )
    assert client_po.status_code == 201, client_po.text
    assert (
        production_lab.client.patch(
            f"/v1/client-purchase-orders/{client_po.json()['id']}", json={"status": "active"}
        ).status_code
        == 200
    )

    vendor_id = _create_company(production_lab, name=f"CRM vendor {uuid4().hex[:6]}", company_type="vendor")
    vendor_po = production_lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": production_lab.data.show_id,
            "po_number": f"CRM-VENDOR-{uuid4().hex[:8]}",
            "approved_amount": 400,
        },
    )
    assert vendor_po.status_code == 201, vendor_po.text
    assert (
        production_lab.client.patch(
            f"/v1/purchase-orders/{vendor_po.json()['id']}", json={"status": "approved"}
        ).status_code
        == 200
    )
    production_lab.execute(
        """
        INSERT INTO vendor_invoices (
          id, organization_id, vendor_company_id, show_id, invoice_number, amount, currency, status
        ) VALUES ($1, $2, $3, $4, $5, 120, 'GBP', 'received')
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        vendor_id,
        production_lab.data.show_id,
        f"SUP-{uuid4().hex[:8]}",
    )

    client_account = production_lab.client.get(f"/v1/crm/accounts/{production_lab.data.client_company_id}")
    vendor_account = production_lab.client.get(f"/v1/crm/accounts/{vendor_id}")
    assert client_account.status_code == vendor_account.status_code == 200
    client_payload = client_account.json()
    vendor_payload = vendor_account.json()
    assert client_payload["account_kind"] == "client"
    assert client_payload["commercial_summary"]["billable_amount"] == 125
    assert len(client_payload["client_purchase_orders"]) == 1
    assert "purchase_orders" not in client_payload
    assert "vendor_invoices" not in client_payload
    assert vendor_payload["account_kind"] == "vendor"
    assert vendor_payload["purchase_orders"][0]["id"] == vendor_po.json()["id"]
    assert vendor_payload["vendor_invoices"][0]["amount"] == 120

    production_lab.sign_out()
    production_lab.sign_in_as_client()
    forbidden = production_lab.client.get(f"/v1/crm/accounts/{vendor_id}")
    assert forbidden.status_code == 403
