"""FastAPI coverage for the operational work-order lifecycle.

The commercial PO/billable flows intentionally remain in their own API test
modules.  These tests protect the operational boundary: a work order can be
created, assigned, reviewed and completed without leaking another tenant's
episode, person or work item.
"""

from __future__ import annotations

import json
import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Work-order FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _payload(lab: ProductionApiLab, **overrides: object) -> dict[str, object]:
    episode_id = overrides.pop("episode_id", None)
    if episode_id is None:
        episode_id = _episode_id(lab)
    return {
        "episode_id": episode_id,
        "workflow_stage_id": lab.data.workflow_stage_id,
        "title": "Resolve client title-card correction",
        "department": "Editorial",
        "assignee_person_id": lab.data.editor_person_id,
        "priority": "high",
        **overrides,
    }


def _vendor(lab: ProductionApiLab, *, name: str = "Python external finishing vendor") -> str:
    vendor_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO crm_companies (id, organization_id, name, type)
        VALUES ($1, $2, $3, 'vendor')
        """,
        vendor_id,
        lab.data.organization_id,
        name,
    )
    return vendor_id


def _approved_po(lab: ProductionApiLab, *, vendor_id: str, amount: float, suffix: str) -> str:
    created = lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": lab.data.show_id,
            "episode_id": _episode_id(lab),
            "po_number": f"PY-WO-{suffix}-{uuid4().hex[:6].upper()}",
            "approved_amount": amount,
            "issue_date": "2035-07-01",
            "expiry_date": "2035-08-01",
        },
    )
    assert created.status_code == 201, created.text
    purchase_order_id = created.json()["id"]
    approved = lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    return purchase_order_id


def _active_client_po(lab: ProductionApiLab, *, amount: float, suffix: str) -> str:
    created = lab.client.post(
        "/v1/client-purchase-orders",
        json={
            "client_company_id": lab.data.client_company_id,
            "show_id": lab.data.show_id,
            "episode_id": _episode_id(lab),
            "po_number": f"PY-CLIENT-WO-{suffix}-{uuid4().hex[:6].upper()}",
            "approved_amount": amount,
            "issue_date": "2035-07-01",
            "expiry_date": "2035-08-01",
        },
    )
    assert created.status_code == 201, created.text
    client_purchase_order_id = created.json()["id"]
    activated = lab.client.patch(f"/v1/client-purchase-orders/{client_purchase_order_id}", json={"status": "active"})
    assert activated.status_code == 200, activated.text
    return client_purchase_order_id


def _grant_viewer_commercial_management(lab: ProductionApiLab) -> None:
    lab.execute(
        """
        UPDATE organization_role_policies SET permissions = $1::jsonb
        WHERE organization_id = $2 AND role = 'production_viewer'
        """,
        json.dumps(["manage_production", "manage_commercial"]),
        lab.data.organization_id,
    )


def _add_edit_suite_rate(lab: ProductionApiLab) -> None:
    """Make the edit-room rate resolvable for commercial reservation tests."""
    lab.execute(
        """
        INSERT INTO service_rates (id, organization_id, name, category, unit, rate, currency, is_active)
        VALUES ($1, $2, 'Work-order edit suite', 'Edit suite', 'hour', 125, 'GBP', true)
        """,
        str(uuid4()),
        lab.data.organization_id,
    )


def _start_work_order(lab: ProductionApiLab, work_order_id: str) -> None:
    submitted = lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"})
    assert submitted.status_code == 200, submitted.text
    approved = lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"status": "in_progress", "approval_note": "Approved for facility scheduling."},
    )
    assert approved.status_code == 200, approved.text


def _submit_external_work_order(lab: ProductionApiLab, *, vendor_id: str, po_id: str, estimate: float) -> str:
    created = lab.client.post(
        "/v1/work-orders",
        json=_payload(
            lab,
            title="External colour finishing change",
            work_type="external_vendor",
            vendor_company_id=vendor_id,
            purchase_order_id=po_id,
            estimated_amount=estimate,
        ),
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    submitted = lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"})
    assert submitted.status_code == 200, submitted.text
    return work_order_id


def _submit_client_billable_work_order(
    lab: ProductionApiLab, *, client_po_id: str, quote: float, title: str = "Client grading change"
) -> str:
    created = lab.client.post(
        "/v1/work-orders",
        json=_payload(
            lab,
            title=title,
            work_type="internal",
            billing_scope="billable_change",
            client_purchase_order_id=client_po_id,
            client_quote_amount=quote,
        ),
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    submitted = lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"})
    assert submitted.status_code == 200, submitted.text
    return work_order_id


def test_work_order_create_defaults_stage_work_to_blocking_and_keeps_item_ledger_tenant_scoped(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    response = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            items=[
                {
                    "type": "service",
                    "description": "Retitle timing pass",
                    "quantity": 3,
                    "unit": "hour",
                    "unit_rate": 85,
                    "discount_percent": 0,
                },
                {
                    "type": "expense",
                    "description": "Secure client transfer",
                    "quantity": 1,
                    "unit": "fixed",
                    "unit_rate": 18.5,
                    "discount_percent": 0,
                },
            ],
        ),
    )

    assert response.status_code == 201, response.text
    work_order_id = response.json()["id"]
    saved = production_lab.fetchrow(
        """
        SELECT organization_id::text, episode_id::text, workflow_stage_id::text,
               is_blocking, status, work_type, billing_status
        FROM post_work_orders WHERE id = $1
        """,
        work_order_id,
    )
    assert saved and dict(saved) == {
        "organization_id": production_lab.data.organization_id,
        "episode_id": _episode_id(production_lab),
        "workflow_stage_id": production_lab.data.workflow_stage_id,
        "is_blocking": True,
        "status": "open",
        "work_type": "internal",
        "billing_status": "not_billable",
    }
    detail = production_lab.client.get(f"/v1/work-orders/{work_order_id}")
    assert detail.status_code == 200, detail.text
    assert [(item["type"], item["quantity"], item["unit_rate"]) for item in detail.json()["items"]] == [
        ("service", "3.00", "85.00"),
        ("expense", "1.00", "18.50"),
    ]
    assert work_order_id in {item["id"] for item in production_lab.client.get("/v1/work-orders").json()["work_orders"]}


def test_work_order_lifecycle_allows_the_creator_with_approval_capability_to_approve(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    created = production_lab.client.post("/v1/work-orders", json=_payload(production_lab, title="Review an ADR pickup"))
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]

    submitted = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"})
    self_approval = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "in_progress"})
    assert submitted.status_code == 200
    assert self_approval.status_code == 200, self_approval.text

    # Give the second internal user the same *capability*, not a named role.
    # The endpoint must resolve the live tenant policy for every request.
    production_lab.execute(
        """
        UPDATE organization_role_policies SET permissions = $1::jsonb
        WHERE organization_id = $2 AND role = 'production_viewer'
        """,
        json.dumps(["manage_production", "do_assigned_work"]),
        production_lab.data.organization_id,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    premature_complete = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "complete"})
    reservation = production_lab.client.post(
        f"/v1/work-orders/{work_order_id}/booking",
        json={
            "room_id": production_lab.data.room_id,
            "starts_at": "2035-08-20T14:00:00Z",
            "ends_at": "2035-08-20T16:00:00Z",
        },
    )
    complete = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "complete"})

    assert complete.status_code == 200
    assert reservation.status_code == 201
    assert premature_complete.status_code == 409
    assert "Place a room booking" in premature_complete.json()["detail"]
    saved = production_lab.fetchrow(
        "SELECT status, approved_by_person_id::text, completed_by_person_id::text FROM post_work_orders WHERE id = $1",
        work_order_id,
    )
    viewer_person_id = production_lab.fetchval(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.viewer_user_id,
    )
    assert saved and dict(saved) == {
        "status": "complete",
        "approved_by_person_id": production_lab.data.manager_person_id,
        "completed_by_person_id": viewer_person_id,
    }


def test_client_billable_approval_creates_one_live_client_po_commitment_and_reconciles_changes(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    first_client_po = _active_client_po(production_lab, amount=1_000, suffix="FIRST")
    second_client_po = _active_client_po(production_lab, amount=1_000, suffix="SECOND")
    work_order_id = _submit_client_billable_work_order(production_lab, client_po_id=first_client_po, quote=350)

    # A selected PO is only a draft association until a separate manager
    # approves the billable work order.
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM client_purchase_order_allocations WHERE organization_id = $1 AND work_order_id = $2",
            production_lab.data.organization_id,
            work_order_id,
        )
        == 0
    )
    _grant_viewer_commercial_management(production_lab)
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    approved = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "in_progress"})
    assert approved.status_code == 200, approved.text

    first = production_lab.fetchrow(
        """
        SELECT id::text, client_purchase_order_id::text, work_order_id::text, amount::text, allocation_type
        FROM client_purchase_order_allocations
        WHERE organization_id = $1 AND work_order_id = $2
        """,
        production_lab.data.organization_id,
        work_order_id,
    )
    assert first and dict(first) == {
        "id": first["id"],
        "client_purchase_order_id": first_client_po,
        "work_order_id": work_order_id,
        "amount": "350.00",
        "allocation_type": "work_order",
    }

    quote_changed = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"client_quote_amount": 525})
    po_changed = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"client_purchase_order_id": second_client_po}
    )
    duplicate_safe_retry = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"client_quote_amount": 525}
    )
    assert quote_changed.status_code == po_changed.status_code == duplicate_safe_retry.status_code == 200

    updated = production_lab.fetchrow(
        """
        SELECT id::text, client_purchase_order_id::text, amount::text
        FROM client_purchase_order_allocations
        WHERE organization_id = $1 AND work_order_id = $2
        """,
        production_lab.data.organization_id,
        work_order_id,
    )
    assert updated and dict(updated) == {
        "id": first["id"],
        "client_purchase_order_id": second_client_po,
        "amount": "525.00",
    }
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM client_purchase_order_allocations WHERE organization_id = $1 AND work_order_id = $2",
            production_lab.data.organization_id,
            work_order_id,
        )
        == 1
    )
    detail = production_lab.client.get(f"/v1/client-purchase-orders/{second_client_po}")
    assert detail.status_code == 200
    assert detail.json()["committed_to_bill_amount"] == 525

    converted = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"billing_scope": "included"})
    assert converted.status_code == 200, converted.text
    assert converted.json()["client_purchase_order_id"] is None
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM client_purchase_order_allocations WHERE organization_id = $1 AND work_order_id = $2",
            production_lab.data.organization_id,
            work_order_id,
        )
        == 0
    )


def test_client_billable_commitment_requires_commercial_capability_and_an_overrun_reason(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    client_po_id = _active_client_po(production_lab, amount=100, suffix="OVERRUN")
    work_order_id = _submit_client_billable_work_order(production_lab, client_po_id=client_po_id, quote=150)

    production_lab.execute(
        """
        UPDATE organization_role_policies SET permissions = $1::jsonb
        WHERE organization_id = $2 AND role = 'production_viewer'
        """,
        json.dumps(["manage_production"]),
        production_lab.data.organization_id,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    without_commercial = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "in_progress"})
    assert without_commercial.status_code == 403

    _grant_viewer_commercial_management(production_lab)
    unexplained = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "in_progress"})
    authorised = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={
            "status": "in_progress",
            "client_po_overrun_reason": "The client approved an urgent additional grading session.",
        },
    )
    assert unexplained.status_code == 400
    assert authorised.status_code == 200, authorised.text
    detail = production_lab.client.get(f"/v1/client-purchase-orders/{client_po_id}")
    assert detail.status_code == 200
    assert detail.json()["remaining_amount"] == -50
    assert "client_purchase_order.work_order_overrun_authorised" in {
        event["action"] for event in detail.json()["activity"]
    }


def test_client_po_cannot_be_selected_for_foreign_vendor_or_non_billable_work(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    foreign_client_po_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO client_purchase_orders (
          id, organization_id, client_company_id, po_number, currency, approved_amount, status
        ) VALUES ($1, $2, $3, 'FOREIGN-CLIENT-WO-PO', 'GBP', 800, 'active')
        """,
        foreign_client_po_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_company_id,
    )
    foreign = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            billing_scope="billable_change",
            client_purchase_order_id=foreign_client_po_id,
            client_quote_amount=120,
        ),
    )
    vendor = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            work_type="external_vendor",
            vendor_company_id=_vendor(production_lab),
            billing_scope="billable_change",
            client_purchase_order_id=foreign_client_po_id,
            client_quote_amount=120,
        ),
    )
    non_billable = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            billing_scope="included",
            client_purchase_order_id=foreign_client_po_id,
            client_quote_amount=120,
        ),
    )

    assert foreign.status_code == 404
    assert vendor.status_code == non_billable.status_code == 422
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM client_purchase_order_allocations WHERE organization_id = $1",
            production_lab.data.organization_id,
        )
        == 0
    )


def test_external_vendor_approval_creates_one_live_commitment_and_reconciles_commercial_changes(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    first_vendor = _vendor(production_lab, name="Python online vendor")
    second_vendor = _vendor(production_lab, name="Python colour vendor")
    first_po = _approved_po(production_lab, vendor_id=first_vendor, amount=1000, suffix="ONLINE")
    second_po = _approved_po(production_lab, vendor_id=second_vendor, amount=1000, suffix="COLOUR")
    work_order_id = _submit_external_work_order(production_lab, vendor_id=first_vendor, po_id=first_po, estimate=350)

    _grant_viewer_commercial_management(production_lab)
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    approved = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "in_progress"})
    assert approved.status_code == 200, approved.text
    first_allocation = production_lab.fetchrow(
        """
        SELECT id::text, purchase_order_id::text, amount::text
        FROM purchase_order_allocations
        WHERE organization_id = $1 AND work_order_id = $2 AND allocation_type = 'work_order'
        """,
        production_lab.data.organization_id,
        work_order_id,
    )
    assert first_allocation and dict(first_allocation) == {
        "id": first_allocation["id"],
        "purchase_order_id": first_po,
        "amount": "350.00",
    }

    estimate_changed = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"estimated_amount": 525})
    vendor_and_po_changed = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"vendor_company_id": second_vendor, "purchase_order_id": second_po},
    )
    repeated_update = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"estimated_amount": 525})
    assert estimate_changed.status_code == vendor_and_po_changed.status_code == repeated_update.status_code == 200
    allocation_rows = production_lab.fetchrow(
        """
        SELECT id::text, purchase_order_id::text, amount::text
        FROM purchase_order_allocations
        WHERE organization_id = $1 AND work_order_id = $2 AND allocation_type = 'work_order'
        """,
        production_lab.data.organization_id,
        work_order_id,
    )
    assert allocation_rows and dict(allocation_rows) == {
        "id": first_allocation["id"],
        "purchase_order_id": second_po,
        "amount": "525.00",
    }
    assert (
        production_lab.fetchval(
            """
            SELECT count(*) FROM purchase_order_allocations
            WHERE organization_id = $1 AND work_order_id = $2 AND allocation_type = 'work_order'
            """,
            production_lab.data.organization_id,
            work_order_id,
        )
        == 1
    )
    assert (
        production_lab.fetchval(
            """
            SELECT count(*) FROM purchase_order_allocations
            WHERE organization_id = $1 AND purchase_order_id = $2 AND allocation_type = 'work_order'
            """,
            production_lab.data.organization_id,
            first_po,
        )
        == 0
    )

    converted = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"work_type": "internal"})
    assert converted.status_code == 200, converted.text
    saved = production_lab.fetchrow(
        """
        SELECT work_type, vendor_company_id, purchase_order_id, estimated_amount
        FROM post_work_orders WHERE id = $1
        """,
        work_order_id,
    )
    assert saved and dict(saved) == {
        "work_type": "internal",
        "vendor_company_id": None,
        "purchase_order_id": None,
        "estimated_amount": None,
    }
    assert (
        production_lab.fetchval(
            """
            SELECT count(*) FROM purchase_order_allocations
            WHERE organization_id = $1 AND work_order_id = $2 AND allocation_type = 'work_order'
            """,
            production_lab.data.organization_id,
            work_order_id,
        )
        == 0
    )

    # A PO can be added after approval too: the work order was internal for a
    # moment, so this must create a new single commitment rather than leaving
    # commercially approved external work unrepresented in the ledger.
    restored_external = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={
            "work_type": "external_vendor",
            "vendor_company_id": second_vendor,
            "purchase_order_id": second_po,
            "estimated_amount": 275,
        },
    )
    assert restored_external.status_code == 200, restored_external.text
    restored = production_lab.fetchrow(
        """
        SELECT purchase_order_id::text, amount::text FROM purchase_order_allocations
        WHERE organization_id = $1 AND work_order_id = $2 AND allocation_type = 'work_order'
        """,
        production_lab.data.organization_id,
        work_order_id,
    )
    assert restored and dict(restored) == {"purchase_order_id": second_po, "amount": "275.00"}

    # A supplier PO may be closed after work has been committed. Cancellation
    # still needs to release that committed value rather than trapping it.
    closed_po = production_lab.client.patch(f"/v1/purchase-orders/{second_po}", json={"status": "closed"})
    assert closed_po.status_code == 200, closed_po.text
    cancelled = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "cancelled"})
    assert cancelled.status_code == 200, cancelled.text
    assert (
        production_lab.fetchval(
            """
            SELECT count(*) FROM purchase_order_allocations
            WHERE organization_id = $1 AND work_order_id = $2 AND allocation_type = 'work_order'
            """,
            production_lab.data.organization_id,
            work_order_id,
        )
        == 0
    )


def test_external_vendor_approval_requires_reason_and_commercial_capability_for_an_overrun(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    purchase_order_id = _approved_po(production_lab, vendor_id=vendor_id, amount=100, suffix="OVERRUN")
    work_order_id = _submit_external_work_order(
        production_lab, vendor_id=vendor_id, po_id=purchase_order_id, estimate=150
    )
    production_lab.execute(
        """
        UPDATE organization_role_policies SET permissions = $1::jsonb
        WHERE organization_id = $2 AND role = 'production_viewer'
        """,
        json.dumps(["manage_production"]),
        production_lab.data.organization_id,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()

    unexplained = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "in_progress"})
    unauthorised = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"status": "in_progress", "overrun_reason": "Client requested a same-day additional finishing pass."},
    )
    assert unexplained.status_code == 400
    assert unauthorised.status_code == 403
    assert (
        production_lab.fetchval("SELECT status FROM post_work_orders WHERE id = $1", work_order_id)
        == "awaiting_approval"
    )

    _grant_viewer_commercial_management(production_lab)
    authorised = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"status": "in_progress", "overrun_reason": "Client requested a same-day additional finishing pass."},
    )
    assert authorised.status_code == 200, authorised.text
    detail = production_lab.client.get(f"/v1/purchase-orders/{purchase_order_id}")
    assert detail.status_code == 200
    assert detail.json()["committed_amount"] == 150
    assert detail.json()["remaining_amount"] == -50
    assert "purchase_order.work_order_overrun_authorised" in {event["action"] for event in detail.json()["activity"]}


def test_external_vendor_work_order_rejects_foreign_po_selection_without_mutating_commitments(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    vendor_id = _vendor(production_lab)
    created = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            title="External vendor scope test",
            work_type="external_vendor",
            vendor_company_id=vendor_id,
            estimated_amount=120,
        ),
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    foreign_vendor_id = str(uuid4())
    foreign_po_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO crm_companies (id, organization_id, name, type)
        VALUES ($1, $2, 'Foreign Python vendor', 'vendor')
        """,
        foreign_vendor_id,
        production_lab.data.foreign_organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO purchase_orders (
          id, organization_id, vendor_company_id, show_id, episode_id,
          po_number, currency, approved_amount, status
        ) VALUES ($1, $2, $3, $4, $5, 'FOREIGN-WO-PO', 'GBP', 800, 'approved')
        """,
        foreign_po_id,
        production_lab.data.foreign_organization_id,
        foreign_vendor_id,
        production_lab.data.foreign_show_id,
        production_lab.data.foreign_episode_id,
    )

    foreign_update = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"purchase_order_id": foreign_po_id}
    )
    assert foreign_update.status_code == 404
    assert (
        production_lab.fetchval("SELECT purchase_order_id::text FROM post_work_orders WHERE id = $1", work_order_id)
        is None
    )
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM purchase_order_allocations WHERE work_order_id = $1", work_order_id
        )
        == 0
    )


def test_assigned_artist_sees_only_their_work_and_can_update_operational_progress(
    production_lab: ProductionApiLab,
) -> None:
    viewer_person_id = production_lab.fetchval(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.viewer_user_id,
    )
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    created = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            title="Prepare QC correction",
            kind="qc_exception",
            assignee_person_id=viewer_person_id,
        ),
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    visible = production_lab.client.get("/v1/work-orders")
    premature_progress = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"status": "ready_for_review"}
    )
    reservation = production_lab.client.post(
        f"/v1/work-orders/{work_order_id}/booking",
        json={
            "room_id": production_lab.data.room_id,
            "starts_at": "2035-08-21T14:00:00Z",
            "ends_at": "2035-08-21T16:00:00Z",
        },
    )
    progress = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "ready_for_review"})
    detail_change = production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"title": "Not permitted"})
    create = production_lab.client.post(
        "/v1/work-orders", json=_payload(production_lab, episode_id=episode_id, title="Not permitted")
    )

    assert visible.status_code == progress.status_code == 200
    assert premature_progress.status_code == 409
    assert reservation.status_code == 201
    assert {item["id"] for item in visible.json()["work_orders"]} == {work_order_id}
    assert detail_change.status_code == create.status_code == 403


def test_assigned_work_inboxes_hide_orders_until_a_manager_approves_them(
    production_lab: ProductionApiLab,
) -> None:
    """An artist must not receive a task before it can be scheduled or worked."""
    viewer_person_id = production_lab.fetchval(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.viewer_user_id,
    )
    production_lab.sign_in_as_manager()
    created = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            title="Awaiting approval before scheduling",
            assignee_person_id=viewer_person_id,
        ),
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    submitted = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"}
    )
    assert submitted.status_code == 200, submitted.text

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    personal_calendar = production_lab.client.get("/v1/work-orders/inbox")
    my_work = production_lab.client.get("/v1/approvals")

    assert personal_calendar.status_code == my_work.status_code == 200
    assert work_order_id not in {item["id"] for item in personal_calendar.json()["work_orders"]}
    assert work_order_id not in {item["id"] for item in my_work.json()["work_orders"]}

    production_lab.sign_out()
    production_lab.sign_in_as_manager()
    approved = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}",
        json={"status": "in_progress", "approval_note": "Approved for facility scheduling."},
    )
    assert approved.status_code == 200, approved.text

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    personal_calendar = production_lab.client.get("/v1/work-orders/inbox")
    my_work = production_lab.client.get("/v1/approvals")

    assert work_order_id in {item["id"] for item in personal_calendar.json()["work_orders"]}
    assert work_order_id in {item["id"] for item in my_work.json()["work_orders"]}


def test_booking_an_unbooked_ready_for_review_internal_work_order_resumes_it(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    created = production_lab.client.post(
        "/v1/work-orders", json=_payload(production_lab, title="Legacy ready-for-review room work")
    )
    assert created.status_code == 201, created.text
    work_order_id = created.json()["id"]
    production_lab.client.patch(f"/v1/work-orders/{work_order_id}", json={"status": "awaiting_approval"})
    approved = production_lab.client.patch(
        f"/v1/work-orders/{work_order_id}", json={"status": "in_progress", "approval_note": "Approved."}
    )
    assert approved.status_code == 200, approved.text

    # Seed the historical state directly: it mirrors records created before
    # the booking-first completion rule was introduced.
    production_lab.execute("UPDATE post_work_orders SET status = 'ready_for_review' WHERE id = $1", work_order_id)
    reserved = production_lab.client.post(
        f"/v1/work-orders/{work_order_id}/booking",
        json={
            "room_id": production_lab.data.room_id,
            "starts_at": "2035-08-22T14:00:00Z",
            "ends_at": "2035-08-22T16:00:00Z",
        },
    )

    assert reserved.status_code == 201, reserved.text
    assert production_lab.fetchval("SELECT status FROM post_work_orders WHERE id = $1", work_order_id) == "in_progress"


def test_work_order_rejects_foreign_records_and_hides_records_from_clients(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    foreign_episode = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(production_lab, episode_id=production_lab.data.foreign_episode_id),
    )
    foreign_assignee = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(production_lab, assignee_person_id=production_lab.data.foreign_person_id),
    )
    foreign_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, kind, title, priority,
          is_blocking, status, billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'internal', 'work_order', 'Foreign work', 'normal',
          false, 'open', 'included', 'not_billable', 'GBP'
        )
        """,
        foreign_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_episode_id,
    )
    foreign_get = production_lab.client.get(f"/v1/work-orders/{foreign_id}")
    foreign_update = production_lab.client.patch(f"/v1/work-orders/{foreign_id}", json={"status": "cancelled"})

    production_lab.sign_out()
    production_lab.sign_in_as_client()
    client_list = production_lab.client.get("/v1/work-orders")
    client_get = production_lab.client.get(f"/v1/work-orders/{foreign_id}")

    assert foreign_episode.status_code == foreign_assignee.status_code == 404
    assert foreign_get.status_code == foreign_update.status_code == 404
    assert client_list.status_code == 200
    assert client_list.json()["work_orders"] == []
    assert client_get.status_code == 404


def test_assigned_artist_can_reserve_an_active_internal_work_order_without_bypassing_conflicts(
    production_lab: ProductionApiLab,
) -> None:
    viewer_person_id = production_lab.fetchval(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.viewer_user_id,
    )
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    first = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            title="Quick colour pickup",
            kind="qc_exception",
            assignee_person_id=viewer_person_id,
        ),
    )
    second = production_lab.client.post(
        "/v1/work-orders",
        json=_payload(
            production_lab,
            title="Conflicting colour pickup",
            kind="qc_exception",
            assignee_person_id=viewer_person_id,
        ),
    )
    assert first.status_code == second.status_code == 201

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    payload = {
        "room_id": production_lab.data.room_id,
        "starts_at": "2035-08-20T14:00:00Z",
        "ends_at": "2035-08-20T16:00:00Z",
        "notes": "Confirmed after client call.",
    }
    reserved = production_lab.client.post(f"/v1/work-orders/{first.json()['id']}/booking", json=payload)
    duplicate = production_lab.client.post(f"/v1/work-orders/{first.json()['id']}/booking", json=payload)
    conflict = production_lab.client.post(f"/v1/work-orders/{second.json()['id']}/booking", json=payload)
    foreign_room = production_lab.client.post(
        f"/v1/work-orders/{second.json()['id']}/booking",
        json={**payload, "room_id": production_lab.data.foreign_room_id},
    )

    assert reserved.status_code == 201, reserved.text
    assert duplicate.status_code == conflict.status_code == 409
    assert foreign_room.status_code == 404
    booking_id = reserved.json()["id"]
    saved = production_lab.fetchrow(
        """
        SELECT organization_id::text, room_id::text, person_id::text, episode_id::text,
               status, booking_type, is_option, notes
        FROM bookings WHERE id = $1
        """,
        booking_id,
    )
    assert saved and dict(saved) == {
        "organization_id": production_lab.data.organization_id,
        "room_id": production_lab.data.room_id,
        "person_id": viewer_person_id,
        "episode_id": episode_id,
        "status": "confirmed",
        "booking_type": "edit",
        "is_option": False,
        "notes": "Confirmed after client call.",
    }
    assert (
        production_lab.fetchval("SELECT booking_id::text FROM post_work_orders WHERE id = $1", first.json()["id"])
        == booking_id
    )
    # The calendar identifies work reservations from this authoritative link,
    # never from a title such as "Work order · …".
    listed = production_lab.client.get("/v1/bookings")
    assert listed.status_code == 200, listed.text
    calendar_booking = next(item for item in listed.json()["bookings"] if item["id"] == booking_id)
    assert calendar_booking["work_order_id"] == first.json()["id"]
    actions = production_lab.fetchval(
        """
        SELECT count(*) FROM activity_log
        WHERE organization_id = $1
          AND (
            (entity_id = $2 AND action = 'work_order.booking_scheduled')
            OR (entity_id = $3 AND action = 'booking.created_from_work_order')
          )
        """,
        production_lab.data.organization_id,
        first.json()["id"],
        booking_id,
    )
    assert actions == 2


def test_work_order_room_reservations_preserve_treatment_snapshots_and_prevent_duplicate_billing(
    production_lab: ProductionApiLab,
) -> None:
    """A work order becomes one commercial booking, never a second charge."""
    production_lab.sign_in_as_manager()
    _add_edit_suite_rate(production_lab)

    work_orders: dict[str, str] = {}
    for treatment, title, start, quote, assignee_person_id in (
        ("wet_hire", "Wet-hire picture fix", "2035-09-10T09:00:00Z", None, production_lab.data.editor_person_id),
        ("dry_hire", "Dry-hire suite reservation", "2035-09-10T12:00:00Z", None, None),
        ("flat_project_fee", "Flat-fee client change", "2035-09-10T15:00:00Z", 900, production_lab.data.editor_person_id),
    ):
        created = production_lab.client.post(
            "/v1/work-orders",
            json=_payload(
                production_lab,
                title=title,
                commercial_treatment=treatment,
                billing_scope="billable_change" if treatment == "flat_project_fee" else "included",
                client_quote_amount=quote,
                assignee_person_id=assignee_person_id,
            ),
        )
        assert created.status_code == 201, created.text
        work_order_id = created.json()["id"]
        _start_work_order(production_lab, work_order_id)
        reserved = production_lab.client.post(
            f"/v1/work-orders/{work_order_id}/booking",
            json={
                "room_id": production_lab.data.room_id,
                "starts_at": start,
                "ends_at": start.replace("T09:", "T11:").replace("T12:", "T14:").replace("T15:", "T17:"),
            },
        )
        assert reserved.status_code == 201, reserved.text
        work_orders[treatment] = reserved.json()["id"]

    wet_booking = production_lab.fetchrow(
        "SELECT person_id::text, commercial_treatment FROM bookings WHERE id = $1", work_orders["wet_hire"]
    )
    dry_booking = production_lab.fetchrow(
        "SELECT person_id::text, commercial_treatment FROM bookings WHERE id = $1", work_orders["dry_hire"]
    )
    assert wet_booking and dict(wet_booking) == {
        "person_id": production_lab.data.editor_person_id,
        "commercial_treatment": "wet_hire",
    }
    assert dry_booking and dict(dry_booking) == {"person_id": None, "commercial_treatment": "dry_hire"}

    def component_rows(booking_id: str) -> list[dict[str, object]]:
        response = production_lab.client.get(f"/v1/bookings/{booking_id}/commercial-components")
        assert response.status_code == 200, response.text
        return response.json()["components"]

    wet_components = component_rows(work_orders["wet_hire"])
    dry_components = component_rows(work_orders["dry_hire"])
    flat_components = component_rows(work_orders["flat_project_fee"])
    assert {row["component_type"] for row in wet_components} == {"room", "person"}
    assert {row["component_type"] for row in dry_components} == {"room"}
    assert all(row["commercial_treatment"] == "wet_hire" for row in wet_components)
    assert all(row["commercial_treatment"] == "dry_hire" for row in dry_components)
    assert {row["component_type"] for row in flat_components} == {"fixed_fee", "room", "person"}
    fixed_fee = next(row for row in flat_components if row["component_type"] == "fixed_fee")
    assert fixed_fee["billing_treatment"] == "billable"
    assert fixed_fee["estimated_charge"] == 900.0
    assert all(
        row["billing_treatment"] == "included" for row in flat_components if row["component_type"] != "fixed_fee"
    )

    flat_work_order_id = production_lab.fetchval(
        "SELECT id::text FROM post_work_orders WHERE booking_id = $1", work_orders["flat_project_fee"]
    )
    charges = production_lab.client.get("/v1/billing/work-order-charges")
    assert charges.status_code == 200, charges.text
    assert flat_work_order_id not in {row["id"] for row in charges.json()["work_order_charges"]}
    duplicate_billable = production_lab.client.post(f"/v1/billing/work-orders/{flat_work_order_id}/billables", json={})
    assert duplicate_billable.status_code == 409
    assert "linked booking components" in duplicate_billable.json()["detail"]
