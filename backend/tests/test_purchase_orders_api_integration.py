"""FastAPI vendor-PO register, lifecycle, balance and tenant-boundary tests."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Purchase-order FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _vendor(lab: ProductionApiLab) -> str:
    vendor_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO crm_companies (id, organization_id, name, type)
        VALUES ($1, $2, $3, 'vendor')
        """,
        vendor_id,
        lab.data.organization_id,
        f"Python Finishing Vendor {vendor_id[:8]}",
    )
    return vendor_id


def _payload(lab: ProductionApiLab, vendor_id: str, **overrides: object) -> dict[str, object]:
    return {
        "vendor_company_id": vendor_id,
        "show_id": lab.data.show_id,
        "episode_id": _episode_id(lab),
        "po_number": f"PY-PO-{uuid4().hex[:8].upper()}",
        "approved_amount": 1000,
        "issue_date": "2035-07-01",
        "expiry_date": "2035-08-01",
        "notes": "Approved supplier finishing support.",
        **overrides,
    }


def _budget_line(lab: ProductionApiLab, *, amount: float = 500) -> str:
    line_id = str(uuid4())
    episode_id = _episode_id(lab)
    season_id = lab.fetchval("SELECT season_id::text FROM episodes WHERE id = $1", episode_id)
    lab.execute(
        """
        INSERT INTO budget_lines (
          id, organization_id, show_id, season_id, episode_id, category,
          budgeted_amount, actual_amount, currency, cost_type, external_cost
        ) VALUES ($1, $2, $3, $4, $5, 'External finishing', $6, 0, 'GBP', 'internal', true)
        """,
        line_id,
        lab.data.organization_id,
        lab.data.show_id,
        season_id,
        episode_id,
        amount,
    )
    return line_id


def _other_episode(lab: ProductionApiLab, *, other_show: bool) -> tuple[str, str]:
    show_id = lab.data.show_id if not other_show else str(uuid4())
    season_id = str(uuid4())
    episode_id = str(uuid4())
    if other_show:
        lab.execute(
            """
            INSERT INTO shows (id, organization_id, title, code, time_zone)
            VALUES ($1, $2, 'Python Alternate Series', 'PYALT', 'Europe/London')
            """,
            show_id,
            lab.data.organization_id,
        )
    lab.execute(
        "INSERT INTO seasons (id, organization_id, show_id, number) VALUES ($1, $2, $3, 9)",
        season_id,
        lab.data.organization_id,
        show_id,
    )
    lab.execute(
        """
        INSERT INTO episodes (id, organization_id, season_id, number, title, status, workflow_status, qc_status)
        VALUES ($1, $2, $3, 9, 'Python alternate episode', 'development', 'not_started', 'not_started')
        """,
        episode_id,
        lab.data.organization_id,
        season_id,
    )
    return show_id, episode_id


def _external_work_order(lab: ProductionApiLab, *, vendor_id: str, episode_id: str) -> str:
    work_order_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, vendor_company_id, kind,
          title, priority, is_blocking, status, billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'external_vendor', $4, 'work_order',
          'External finishing', 'normal', false, 'in_progress', 'included', 'not_billable', 'GBP'
        )
        """,
        work_order_id,
        lab.data.organization_id,
        episode_id,
        vendor_id,
    )
    return work_order_id


def _vendor_invoice(lab: ProductionApiLab, *, vendor_id: str, episode_id: str) -> str:
    invoice_id = str(uuid4())
    show_id = lab.fetchval(
        """
        SELECT seasons.show_id::text FROM episodes
        JOIN seasons ON seasons.id = episodes.season_id
        WHERE episodes.id = $1
        """,
        episode_id,
    )
    lab.execute(
        """
        INSERT INTO vendor_invoices (
          id, organization_id, vendor_company_id, show_id, episode_id,
          invoice_number, amount, currency, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 600, 'GBP', 'received')
        """,
        invoice_id,
        lab.data.organization_id,
        vendor_id,
        show_id,
        episode_id,
        f"PY-SUPPLIER-{uuid4().hex[:8].upper()}",
    )
    return invoice_id


def test_purchase_order_register_creates_a_draft_and_calculates_live_commitment_balances(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert created.status_code == 201, created.text
    purchase_order_id = created.json()["id"]
    approved = production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text

    first_line = _budget_line(production_lab)
    first = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/allocations",
        json={
            "allocation_type": "budget_line",
            "budget_line_id": first_line,
            "amount": 600,
            "allocation_date": "2035-07-02",
            "reference": "EXT-001",
        },
    )
    duplicate = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/allocations",
        json={
            "allocation_type": "budget_line",
            "budget_line_id": first_line,
            "amount": 600,
            "allocation_date": "2035-07-02",
        },
    )
    second_line = _budget_line(production_lab)
    overrun = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/allocations",
        json={
            "allocation_type": "budget_line",
            "budget_line_id": second_line,
            "amount": 500,
            "allocation_date": "2035-07-03",
            "overrun_reason": "Supplier added a required finishing pass after review.",
        },
    )

    assert first.status_code == overrun.status_code == 201
    assert duplicate.status_code == 409
    detail = production_lab.client.get(f"/v1/purchase-orders/{purchase_order_id}")
    assert detail.status_code == 200
    assert detail.json()["authorised_amount"] == 1000
    assert detail.json()["committed_amount"] == 1100
    assert detail.json()["actual_invoiced_amount"] == 0
    assert detail.json()["remaining_amount"] == -100
    assert detail.json()["variance_amount"] == -1000
    assert (
        production_lab.fetchval("SELECT purchase_order_id::text FROM budget_lines WHERE id = $1", first_line)
        == purchase_order_id
    )


def test_purchase_order_enforces_capability_draft_edits_and_one_way_status(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    edited = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}", json={"notes": "Revised finishing approval."}
    )
    approved = production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"})
    late_edit = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}", json={"notes": "No longer editable"}
    )
    closed = production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "closed"})
    reopened = production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"})

    assert edited.status_code == approved.status_code == closed.status_code == 200
    assert late_edit.status_code == reopened.status_code == 409
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/purchase-orders").status_code == 403


def test_vendor_actual_endpoint_records_live_costs_and_scopes_the_linked_po(
    production_lab: ProductionApiLab,
) -> None:
    """The former Next vendor-invoice route is now a FastAPI-only mutation."""
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    episode_id = _episode_id(production_lab)
    created = production_lab.client.post(
        "/v1/purchase-orders",
        json=_payload(production_lab, vendor_id, episode_id=episode_id, approved_amount=1000),
    )
    assert created.status_code == 201, created.text
    purchase_order_id = created.json()["id"]
    approved = production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    work_order_id = _external_work_order(production_lab, vendor_id=vendor_id, episode_id=episode_id)
    production_lab.execute(
        "UPDATE post_work_orders SET purchase_order_id = $1 WHERE id = $2",
        purchase_order_id,
        work_order_id,
    )

    payload = {
        "vendor_company_id": vendor_id,
        "episode_id": episode_id,
        "work_order_id": work_order_id,
        "invoice_number": "PY-VENDOR-ACTUAL-001",
        "description": "Additional conform support",
        "amount": 425.5,
        "invoice_date": "2035-07-05",
        "status": "received",
    }
    recorded = production_lab.client.post("/v1/vendor-invoices", json=payload)
    duplicate = production_lab.client.post("/v1/vendor-invoices", json=payload)

    assert recorded.status_code == 201, recorded.text
    assert duplicate.status_code == 409
    detail = production_lab.client.get(f"/v1/purchase-orders/{purchase_order_id}")
    assert detail.status_code == 200
    assert detail.json()["actual_invoiced_amount"] == 425.5
    assert detail.json()["committed_amount"] == 0
    actual_amount = production_lab.fetchval(
        "SELECT actual_amount FROM post_work_orders WHERE id = $1",
        work_order_id,
    )
    assert float(actual_amount) == 425.5


def test_purchase_orders_reject_foreign_scope_and_hide_foreign_register_records(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    foreign_vendor_id = str(uuid4())
    foreign_po_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Foreign vendor', 'vendor')",
        foreign_vendor_id,
        production_lab.data.foreign_organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO purchase_orders (
          id, organization_id, vendor_company_id, po_number, currency, approved_amount, status
        ) VALUES ($1, $2, $3, 'FOREIGN-PO-001', 'GBP', 1000, 'approved')
        """,
        foreign_po_id,
        production_lab.data.foreign_organization_id,
        foreign_vendor_id,
    )
    foreign_vendor = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, foreign_vendor_id))
    foreign_episode = production_lab.client.post(
        "/v1/purchase-orders",
        json=_payload(production_lab, vendor_id, episode_id=production_lab.data.foreign_episode_id),
    )
    foreign_read = production_lab.client.get(f"/v1/purchase-orders/{foreign_po_id}")
    invalid_status = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, status="approved")
    )

    assert foreign_vendor.status_code == foreign_episode.status_code == foreign_read.status_code == 404
    assert invalid_status.status_code == 403


def test_purchase_order_supplier_actual_creates_one_invoice_allocation_and_budget_actual(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, approved_amount=900)
    )
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"}).status_code
        == 200
    )

    actual = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/actual-costs",
        json={
            "invoice_number": "PY-FIN-2048",
            "invoice_date": "2035-07-08",
            "amount": 312.45,
            "description": "Caption correction and verification",
            "external_document_url": "https://vendor.postpilot.test/invoices/PY-FIN-2048",
        },
    )
    duplicate = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/actual-costs",
        json={
            "invoice_number": "PY-FIN-2048",
            "invoice_date": "2035-07-08",
            "amount": 312.45,
            "description": "Duplicate supplier invoice",
        },
    )

    assert actual.status_code == 201, actual.text
    assert duplicate.status_code == 409
    invoice = production_lab.fetchrow(
        """
        SELECT vendor_company_id::text, show_id::text, episode_id::text, invoice_number, amount::text,
               external_document_url
        FROM vendor_invoices WHERE id = $1
        """,
        actual.json()["invoice_id"],
    )
    assert invoice and dict(invoice) == {
        "vendor_company_id": vendor_id,
        "show_id": production_lab.data.show_id,
        "episode_id": _episode_id(production_lab),
        "invoice_number": "PY-FIN-2048",
        "amount": "312.45",
        "external_document_url": "https://vendor.postpilot.test/invoices/PY-FIN-2048",
    }
    budget = production_lab.fetchrow(
        """
        SELECT purchase_order_id::text, vendor_invoice_id::text, actual_amount::text, external_cost
        FROM budget_lines WHERE id = $1
        """,
        actual.json()["budget_line_id"],
    )
    assert budget and dict(budget) == {
        "purchase_order_id": purchase_order_id,
        "vendor_invoice_id": actual.json()["invoice_id"],
        "actual_amount": "312.45",
        "external_cost": True,
    }
    detail = actual.json()["purchase_order"]
    assert detail["actual_invoiced_amount"] == 312.45
    assert detail["committed_amount"] == 0
    assert detail["remaining_amount"] == 900


def test_purchase_order_number_is_unique_inside_a_tenant_but_not_globally(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    shared_number = "PY-PO-SHARED-001"
    first = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, po_number=shared_number)
    )
    duplicate = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, po_number=shared_number)
    )
    foreign_vendor_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Foreign supplier', 'vendor')",
        foreign_vendor_id,
        production_lab.data.foreign_organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO purchase_orders (
          id, organization_id, vendor_company_id, po_number, currency, approved_amount, status
        ) VALUES ($1, $2, $3, $4, 'GBP', 1000, 'draft')
        """,
        str(uuid4()),
        production_lab.data.foreign_organization_id,
        foreign_vendor_id,
        shared_number,
    )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert production_lab.fetchval("SELECT count(*) FROM purchase_orders WHERE po_number = $1", shared_number) == 2


def test_purchase_order_draft_scope_edits_are_tenant_safe_and_show_episode_coherent(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    primary_episode_id = _episode_id(production_lab)
    alternate_show_id, alternate_episode_id = _other_episode(production_lab, other_show=True)
    foreign_vendor_id = str(uuid4())
    production_lab.execute(
        "INSERT INTO crm_companies (id, organization_id, name, type) VALUES ($1, $2, 'Foreign supplier', 'vendor')",
        foreign_vendor_id,
        production_lab.data.foreign_organization_id,
    )

    foreign_vendor = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}", json={"vendor_company_id": foreign_vendor_id}
    )
    foreign_show = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}", json={"show_id": production_lab.data.foreign_show_id}
    )
    foreign_episode = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}", json={"episode_id": production_lab.data.foreign_episode_id}
    )
    mismatch = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}",
        json={"show_id": alternate_show_id, "episode_id": primary_episode_id},
    )
    valid = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}",
        json={"show_id": alternate_show_id, "episode_id": alternate_episode_id, "notes": "Moved to new scope."},
    )

    assert foreign_vendor.status_code == foreign_show.status_code == foreign_episode.status_code == 404
    assert mismatch.status_code == 400
    assert valid.status_code == 200
    assert valid.json()["show_id"] == alternate_show_id
    assert valid.json()["episode_id"] == alternate_episode_id


def test_purchase_order_allocation_rejects_incompatible_vendor_show_episode_and_internal_cost(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    other_vendor_id = _vendor(production_lab)
    episode_id = _episode_id(production_lab)
    created = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"}).status_code
        == 200
    )
    same_show_other_episode = _other_episode(production_lab, other_show=False)[1]
    other_show_id, other_show_episode = _other_episode(production_lab, other_show=True)
    assert other_show_id != production_lab.data.show_id
    foreign_vendor_work = _external_work_order(production_lab, vendor_id=other_vendor_id, episode_id=episode_id)
    other_episode_work = _external_work_order(production_lab, vendor_id=vendor_id, episode_id=same_show_other_episode)
    other_show_work = _external_work_order(production_lab, vendor_id=vendor_id, episode_id=other_show_episode)
    internal_line = str(uuid4())
    season_id = production_lab.fetchval("SELECT season_id::text FROM episodes WHERE id = $1", episode_id)
    production_lab.execute(
        """
        INSERT INTO budget_lines (
          id, organization_id, show_id, season_id, episode_id, category,
          budgeted_amount, actual_amount, currency, cost_type, external_cost
        ) VALUES ($1, $2, $3, $4, $5, 'Internal editorial', 50, 0, 'GBP', 'internal', false)
        """,
        internal_line,
        production_lab.data.organization_id,
        production_lab.data.show_id,
        season_id,
        episode_id,
    )

    def allocate_work(work_order_id: str):
        return production_lab.client.post(
            f"/v1/purchase-orders/{purchase_order_id}/allocations",
            json={
                "allocation_type": "work_order",
                "work_order_id": work_order_id,
                "amount": 50,
                "allocation_date": "2035-07-03",
            },
        )

    vendor_mismatch = allocate_work(foreign_vendor_work)
    episode_mismatch = allocate_work(other_episode_work)
    show_mismatch = allocate_work(other_show_work)
    internal_cost = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/allocations",
        json={
            "allocation_type": "budget_line",
            "budget_line_id": internal_line,
            "amount": 50,
            "allocation_date": "2035-07-03",
        },
    )

    assert vendor_mismatch.status_code == episode_mismatch.status_code == show_mismatch.status_code == 400
    assert internal_cost.status_code == 409


def test_purchase_order_blocks_allocations_after_close_or_cancellation_but_allows_closed_actuals(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    closed = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert closed.status_code == 201
    closed_id = closed.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/purchase-orders/{closed_id}", json={"status": "approved"}).status_code == 200
    )
    assert production_lab.client.patch(f"/v1/purchase-orders/{closed_id}", json={"status": "closed"}).status_code == 200
    blocked_allocation = production_lab.client.post(
        f"/v1/purchase-orders/{closed_id}/allocations",
        json={
            "allocation_type": "budget_line",
            "budget_line_id": _budget_line(production_lab),
            "amount": 50,
            "allocation_date": "2035-07-03",
        },
    )
    closed_actual = production_lab.client.post(
        f"/v1/purchase-orders/{closed_id}/actual-costs",
        json={
            "invoice_number": "PY-CLOSED-INV",
            "invoice_date": "2035-07-08",
            "amount": 50,
            "description": "Late supplier invoice",
        },
    )
    cancelled = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert cancelled.status_code == 201
    cancelled_id = cancelled.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/purchase-orders/{cancelled_id}", json={"status": "cancelled"}).status_code
        == 200
    )
    cancelled_actual = production_lab.client.post(
        f"/v1/purchase-orders/{cancelled_id}/actual-costs",
        json={
            "invoice_number": "PY-CANCELLED-INV",
            "invoice_date": "2035-07-08",
            "amount": 50,
            "description": "Cancelled PO supplier invoice",
        },
    )

    assert blocked_allocation.status_code == cancelled_actual.status_code == 409
    assert closed_actual.status_code == 201


def test_purchase_order_actual_overrun_requires_a_reason_and_records_the_authorisation(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, approved_amount=100)
    )
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"}).status_code
        == 200
    )
    no_reason = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/actual-costs",
        json={
            "invoice_number": "PY-OVERRUN-1",
            "invoice_date": "2035-07-08",
            "amount": 150,
            "description": "Urgent supplier overrun",
        },
    )
    authorised = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/actual-costs",
        json={
            "invoice_number": "PY-OVERRUN-1",
            "invoice_date": "2035-07-08",
            "amount": 150,
            "description": "Urgent supplier overrun",
            "overrun_reason": "Urgent client revision required an additional vendor finishing pass.",
        },
    )

    assert no_reason.status_code == 400
    assert authorised.status_code == 201
    detail = authorised.json()["purchase_order"]
    assert detail["actual_invoiced_amount"] == 150
    assert detail["variance_amount"] == 50
    assert "purchase_order.actual_overrun_authorised" in {
        row["action"]
        for row in production_lab.client.get(f"/v1/purchase-orders/{purchase_order_id}").json()["activity"]
    }


def test_purchase_order_vendor_invoice_allocations_are_unique_and_scope_checked(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    other_vendor_id = _vendor(production_lab)
    episode_id = _episode_id(production_lab)
    created = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    assert (
        production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"}).status_code
        == 200
    )
    matching_invoice = _vendor_invoice(production_lab, vendor_id=vendor_id, episode_id=episode_id)
    other_vendor_invoice = _vendor_invoice(production_lab, vendor_id=other_vendor_id, episode_id=episode_id)
    other_episode = _other_episode(production_lab, other_show=False)[1]
    other_episode_invoice = _vendor_invoice(production_lab, vendor_id=vendor_id, episode_id=other_episode)
    _, other_show_episode = _other_episode(production_lab, other_show=True)
    other_show_invoice = _vendor_invoice(production_lab, vendor_id=vendor_id, episode_id=other_show_episode)

    def allocate(invoice_id: str):
        return production_lab.client.post(
            f"/v1/purchase-orders/{purchase_order_id}/allocations",
            json={
                "allocation_type": "vendor_invoice",
                "vendor_invoice_id": invoice_id,
                "amount": 600,
                "allocation_date": "2035-07-03",
            },
        )

    matching = allocate(matching_invoice)
    duplicate = allocate(matching_invoice)
    vendor_mismatch = allocate(other_vendor_invoice)
    episode_mismatch = allocate(other_episode_invoice)
    show_mismatch = allocate(other_show_invoice)

    assert matching.status_code == 201
    assert duplicate.status_code == 409
    assert vendor_mismatch.status_code == episode_mismatch.status_code == show_mismatch.status_code == 400
    detail = production_lab.client.get(f"/v1/purchase-orders/{purchase_order_id}")
    assert detail.status_code == 200
    assert detail.json()["actual_invoiced_amount"] == 600


def test_purchase_order_rejects_calculated_values_and_merged_invalid_dates(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    assert created.status_code == 201
    purchase_order_id = created.json()["id"]
    calculated = production_lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"committed_amount": 1})
    invalid_merged_dates = production_lab.client.patch(
        f"/v1/purchase-orders/{purchase_order_id}", json={"issue_date": "2035-09-01"}
    )

    assert calculated.status_code == 422
    assert invalid_merged_dates.status_code == 400


def test_work_order_po_selector_returns_only_approved_vendor_and_episode_compatible_orders(
    production_lab: ProductionApiLab,
) -> None:
    """The UI selector cannot discover a PO outside the work order's scope."""
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    other_vendor_id = _vendor(production_lab)
    episode_id = _episode_id(production_lab)
    matching = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, vendor_id))
    global_scope = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, show_id=None, episode_id=None)
    )
    other_vendor = production_lab.client.post("/v1/purchase-orders", json=_payload(production_lab, other_vendor_id))
    other_episode = _other_episode(production_lab, other_show=False)[1]
    wrong_episode = production_lab.client.post(
        "/v1/purchase-orders", json=_payload(production_lab, vendor_id, episode_id=other_episode)
    )
    for created in (matching, global_scope, other_vendor, wrong_episode):
        assert created.status_code == 201, created.text
    for created in (matching, global_scope, other_vendor, wrong_episode):
        assert (
            production_lab.client.patch(
                f"/v1/purchase-orders/{created.json()['id']}", json={"status": "approved"}
            ).status_code
            == 200
        )

    selected = production_lab.client.get(f"/v1/purchase-orders?vendorId={vendor_id}&episodeId={episode_id}")
    malformed = production_lab.client.get(f"/v1/purchase-orders?vendorId={vendor_id}")

    assert selected.status_code == 200, selected.text
    assert {item["id"] for item in selected.json()["purchase_orders"]} == {
        matching.json()["id"],
        global_scope.json()["id"],
    }
    assert malformed.status_code == 400
