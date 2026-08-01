"""FastAPI budget ledger tests against the shared, tenant-isolated PostgreSQL schema."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Budget FastAPI integration tests run in CI against migrated PostgreSQL.",
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
        VALUES ($1, $2, 'Python Budget Supplier', 'vendor')
        """,
        vendor_id,
        lab.data.organization_id,
    )
    return vendor_id


def _approved_po(lab: ProductionApiLab, *, approved_amount: float = 1_000) -> str:
    vendor_id = _vendor(lab)
    response = lab.client.post(
        "/v1/purchase-orders",
        json={
            "vendor_company_id": vendor_id,
            "show_id": lab.data.show_id,
            "episode_id": _episode_id(lab),
            "po_number": f"PY-BUDGET-{uuid4().hex[:8].upper()}",
            "approved_amount": approved_amount,
        },
    )
    assert response.status_code == 201, response.text
    purchase_order_id = response.json()["id"]
    approved = lab.client.patch(f"/v1/purchase-orders/{purchase_order_id}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    return purchase_order_id


def _work_order(lab: ProductionApiLab, episode_id: str) -> str:
    work_order_id = str(uuid4())
    lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, kind, title, priority,
          is_blocking, status, billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'internal', 'work_order', 'Python conform correction',
          'normal', false, 'in_progress', 'included', 'not_billable', 'GBP'
        )
        """,
        work_order_id,
        lab.data.organization_id,
        episode_id,
    )
    return work_order_id


def _external_budget_line(lab: ProductionApiLab, episode_id: str, *, amount: float = 500) -> str:
    created = lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "External supplier finishing",
            "budgeted_amount": amount,
            "external_cost": True,
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _service_rate(lab: ProductionApiLab, *, category: str, unit: str, rate: float) -> str:
    response = lab.client.post(
        "/v1/rate-cards/services",
        json={"name": f"Python budget rate {uuid4().hex[:8]}", "category": category, "unit": unit, "rate": rate},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _rate_override(lab: ProductionApiLab, *, scope: str, service_rate_id: str, rate: float, **target: object) -> None:
    response = lab.client.post(
        "/v1/rate-cards/overrides",
        json={"scope": scope, "service_rate_id": service_rate_id, "rate": rate, **target},
    )
    assert response.status_code == 201, response.text


def test_commercial_form_options_are_tenant_scoped_and_capability_gated(
    production_lab: ProductionApiLab,
) -> None:
    """The React commercial forms must never fall back to cross-tenant option data."""
    production_lab.sign_in_as_manager()

    response = production_lab.client.get("/v1/budget/options")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert {item["id"] for item in payload["shows"]} >= {production_lab.data.show_id}
    assert production_lab.data.foreign_show_id not in {item["id"] for item in payload["shows"]}
    assert production_lab.data.foreign_episode_id not in {item["id"] for item in payload["episodes"]}
    assert all({"id", "name", "type"} <= item.keys() for item in payload["companies"])
    assert all({"id", "title", "network"} <= item.keys() for item in payload["shows"])
    assert all({"id", "show_id", "show_title", "number", "title"} <= item.keys() for item in payload["episodes"])

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/budget/options").status_code == 403


def test_budget_rate_resolution_snapshots_inherited_rate_and_rejects_foreign_resources(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    service_id = _service_rate(production_lab, category="Python budget finishing", unit="hour", rate=90)
    _rate_override(production_lab, scope="master", service_rate_id=service_id, rate=100)
    _rate_override(
        production_lab,
        scope="client",
        service_rate_id=service_id,
        rate=110,
        client_company_id=production_lab.data.client_company_id,
    )
    _rate_override(production_lab, scope="network", service_rate_id=service_id, rate=120, network="Python Network")
    _rate_override(
        production_lab,
        scope="show",
        service_rate_id=service_id,
        rate=130,
        show_id=production_lab.data.show_id,
    )
    _rate_override(production_lab, scope="episode", service_rate_id=service_id, rate=140, episode_id=episode_id)

    preview = production_lab.client.post(
        "/v1/budget/estimate-preview",
        json={
            "episode_id": episode_id,
            "category": "Ignored because the service is authoritative",
            "planned_quantity": 2,
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": service_id,
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["estimate"] == 280
    assert preview.json()["rate_source"] == "episode_rate_card"

    created = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Ignored because the service is authoritative",
            "description": "Two finishing hours.",
            "budgeted_amount": 1,
            "planned_quantity": 2,
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": service_id,
        },
    )
    assert created.status_code == 201, created.text
    line = created.json()
    assert line["category"] == "Python budget finishing"
    assert line["estimated_amount"] == 280
    assert line["rate_snapshot"] == 140
    assert line["rate_source"] == "episode_rate_card"
    assert line["resource_reference"].startswith(f"service:{service_id}")

    # Changing the live rate card changes future estimates only: this line is a snapshot.
    _rate_override(production_lab, scope="episode", service_rate_id=service_id, rate=175, episode_id=episode_id)
    lines = production_lab.client.get("/v1/budget/lines", params={"episode_id": episode_id})
    assert lines.status_code == 200, lines.text
    persisted = next(item for item in lines.json()["budget_lines"] if item["id"] == line["id"])
    assert persisted["estimated_amount"] == 280
    future = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Python budget finishing",
            "planned_quantity": 2,
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": service_id,
        },
    )
    assert future.status_code == 201, future.text
    assert future.json()["estimated_amount"] == 350
    assert future.json()["rate_snapshot"] == 175

    foreign_service_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO service_rates (id, organization_id, name, category, unit, rate, currency, is_active)
        VALUES ($1, $2, 'Foreign budget rate', 'Python budget finishing', 'hour', 999, 'GBP', true)
        """,
        foreign_service_id,
        production_lab.data.foreign_organization_id,
    )
    foreign = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Python budget finishing",
            "planned_quantity": 1,
            "planned_unit": "hour",
            "rate_resource_type": "service",
            "rate_resource_id": foreign_service_id,
        },
    )
    assert foreign.status_code == 404

    room_service_id = _service_rate(production_lab, category="Python room resource", unit="hour", rate=50)
    person_service_id = _service_rate(production_lab, category="Python person resource", unit="fixed", rate=75)
    _rate_override(production_lab, scope="master", service_rate_id=room_service_id, rate=50)
    _rate_override(production_lab, scope="master", service_rate_id=person_service_id, rate=75)
    room_line = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Python room resource",
            "planned_quantity": 3,
            "planned_unit": "hour",
            "rate_resource_type": "room",
            "rate_resource_id": production_lab.data.room_id,
        },
    )
    person_line = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Python person resource",
            "planned_quantity": 2,
            "planned_unit": "fixed",
            "rate_resource_type": "person",
            "rate_resource_id": production_lab.data.editor_person_id,
        },
    )
    assert room_line.status_code == person_line.status_code == 201
    assert room_line.json()["estimated_amount"] == 150
    assert room_line.json()["resource_reference"].startswith(f"room:{production_lab.data.room_id}")
    assert person_line.json()["estimated_amount"] == 150
    assert person_line.json()["resource_reference"].startswith(f"person:{production_lab.data.editor_person_id}")


def test_budget_lines_create_live_episode_and_show_rollups_with_po_commitments(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    purchase_order_id = _approved_po(production_lab)
    work_order_id = _work_order(production_lab, episode_id)

    external = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "External VFX finishing",
            "description": "Additional paint fixes.",
            "external_cost": True,
            "budgeted_amount": 300,
            "purchase_order_id": purchase_order_id,
        },
    )
    internal = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Online suite",
            "external_cost": False,
            "budgeted_amount": 120,
            "work_order_id": work_order_id,
        },
    )

    assert external.status_code == internal.status_code == 201
    external_actual = production_lab.client.post(
        f"/v1/budget/lines/{external.json()['id']}/manual-actual-adjustments",
        json={"amount": 125, "reason": "Supplier receipt matched to the approved scope."},
    )
    internal_actual = production_lab.client.post(
        f"/v1/budget/lines/{internal.json()['id']}/manual-actual-adjustments",
        json={"amount": 90, "reason": "Historical actual carried into the new ledger."},
    )
    assert external_actual.status_code == internal_actual.status_code == 201
    browser_total = production_lab.client.patch(
        f"/v1/budget/lines/{external.json()['id']}", json={"actual_amount": 999}
    )
    assert browser_total.status_code == 422
    allocation_ledger = production_lab.client.get(
        f"/v1/budget/lines/{external.json()['id']}/actual-allocations"
    )
    assert allocation_ledger.status_code == 200
    allocations = allocation_ledger.json()["actual_allocations"]
    assert len(allocations) == 1
    assert allocations[0]["source_type"] == "manual_adjustment"
    assert allocations[0]["reason"] == "Supplier receipt matched to the approved scope."
    assert allocations[0]["amount"] == 125
    assert allocations[0]["currency"] == "GBP"
    assert external.json()["purchase_order"]["committed_amount"] == 300
    assert internal.json()["work_order"] == {
        "id": work_order_id,
        "title": "Python conform correction",
        "status": "in_progress",
    }

    episode_summary = production_lab.client.get(f"/v1/budget/episodes/{episode_id}/summary")
    show_summary = production_lab.client.get(f"/v1/budget/shows/{production_lab.data.show_id}/summary")
    assert episode_summary.status_code == show_summary.status_code == 200
    summary = episode_summary.json()["summary"]
    assert summary == {
        "line_count": 2,
        "estimated_amount": 420,
        "actual_amount": 215,
        "internal_estimated_amount": 120,
        "internal_actual_amount": 90,
        "external_estimated_amount": 300,
        "external_actual_amount": 125,
        "variance_amount": -205,
        "purchase_orders": {
            "count": 1,
            "authorised_amount": 1000,
            "committed_amount": 300,
            "actual_invoiced_amount": 0,
            "remaining_amount": 700,
        },
    }
    assert show_summary.json()["summary"] == summary


def test_budget_line_update_reconciles_one_po_commitment_and_does_not_duplicate_it(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    purchase_order_id = _approved_po(production_lab)
    created = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Vendor colour fixes",
            "external_cost": True,
            "budgeted_amount": 250,
            "purchase_order_id": purchase_order_id,
        },
    )
    assert created.status_code == 201, created.text
    line_id = created.json()["id"]

    updated = production_lab.client.patch(
        f"/v1/budget/lines/{line_id}",
        json={"budgeted_amount": 325, "description": "Final colour fixes."},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["estimated_amount"] == 325
    adjustment = production_lab.client.post(
        f"/v1/budget/lines/{line_id}/manual-actual-adjustments",
        json={"amount": 300, "reason": "Approved reconciliation after final colour fixes."},
    )
    assert adjustment.status_code == 201, adjustment.text
    assert adjustment.json()["actual_amount"] == 300
    assert updated.json()["purchase_order"]["committed_amount"] == 325
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM purchase_order_allocations WHERE organization_id = $1 AND budget_line_id = $2",
            production_lab.data.organization_id,
            line_id,
        )
        == 1
    )
    assert (
        production_lab.fetchval(
            "SELECT amount FROM purchase_order_allocations WHERE organization_id = $1 AND budget_line_id = $2",
            production_lab.data.organization_id,
            line_id,
        )
        == 325
    )

    released = production_lab.client.patch(f"/v1/budget/lines/{line_id}", json={"purchase_order_id": None})
    assert released.status_code == 200, released.text
    assert released.json()["purchase_order"] is None
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM purchase_order_allocations WHERE organization_id = $1 AND budget_line_id = $2",
            production_lab.data.organization_id,
            line_id,
        )
        == 0
    )


def test_deleting_a_manual_budget_line_releases_its_po_commitment(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    purchase_order_id = _approved_po(production_lab)
    created = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "External audio repair",
            "external_cost": True,
            "budgeted_amount": 275,
            "purchase_order_id": purchase_order_id,
        },
    )
    assert created.status_code == 201, created.text
    line_id = created.json()["id"]

    deleted = production_lab.client.delete(f"/v1/budget/lines/{line_id}")
    assert deleted.status_code == 204, deleted.text
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM budget_lines WHERE organization_id = $1 AND id = $2",
            production_lab.data.organization_id,
            line_id,
        )
        == 0
    )
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM purchase_order_allocations WHERE organization_id = $1 AND budget_line_id = $2",
            production_lab.data.organization_id,
            line_id,
        )
        == 0
    )


def test_budget_summary_reports_vendor_actuals_once_with_po_actuals_kept_separate(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    purchase_order_id = _approved_po(production_lab)
    budget_line_id = _external_budget_line(production_lab, episode_id)

    invoice = production_lab.client.post(
        f"/v1/purchase-orders/{purchase_order_id}/actual-costs",
        json={
            "episode_id": episode_id,
            "budget_line_id": budget_line_id,
            "invoice_number": f"PY-SUPPLIER-{uuid4().hex[:8].upper()}",
            "invoice_date": "2035-07-10",
            "amount": 275,
            "description": "Final vendor paint fixes.",
        },
    )
    assert invoice.status_code == 201, invoice.text

    summary = production_lab.client.get(f"/v1/budget/episodes/{episode_id}/summary")
    assert summary.status_code == 200, summary.text
    values = summary.json()["summary"]
    assert values["estimated_amount"] == 500
    assert values["actual_amount"] == values["external_actual_amount"] == 275
    # PO actuals are visible in their own authorisation ledger and must not be
    # added to `actual_amount` a second time.
    assert values["purchase_orders"]["actual_invoiced_amount"] == 275


def test_budget_api_requires_commercial_capability_and_validates_tenant_references(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get(f"/v1/budget/episodes/{production_lab.data.show_id}/summary").status_code == 403
    assert (
        production_lab.client.post(
            "/v1/budget/lines",
            json={"episode_id": production_lab.data.foreign_episode_id, "category": "No access"},
        ).status_code
        == 403
    )

    production_lab.sign_out()
    production_lab.sign_in_as_manager()
    foreign_vendor_id = str(uuid4())
    foreign_po_id = str(uuid4())
    foreign_work_order_id = str(uuid4())
    foreign_budget_line_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO crm_companies (id, organization_id, name, type)
        VALUES ($1, $2, 'Foreign budget vendor', 'vendor')
        """,
        foreign_vendor_id,
        production_lab.data.foreign_organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO purchase_orders (
          id, organization_id, vendor_company_id, po_number, currency, approved_amount, status
        )
        VALUES ($1, $2, $3, 'FOREIGN-BUDGET-001', 'GBP', 1000, 'approved')
        """,
        foreign_po_id,
        production_lab.data.foreign_organization_id,
        foreign_vendor_id,
    )
    production_lab.execute(
        """
        INSERT INTO post_work_orders (
          id, organization_id, episode_id, work_type, kind, title, priority,
          is_blocking, status, billing_scope, billing_status, currency
        ) VALUES (
          $1, $2, $3, 'internal', 'work_order', 'Foreign correction',
          'normal', false, 'in_progress', 'included', 'not_billable', 'GBP'
        )
        """,
        foreign_work_order_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_episode_id,
    )
    production_lab.execute(
        """
        INSERT INTO budget_lines (
          id, organization_id, show_id, season_id, episode_id, category,
          budgeted_amount, actual_amount, currency, cost_type, external_cost
        ) VALUES ($1, $2, $3, $4, $5, 'Foreign budget line', 100, 0, 'GBP', 'internal', false)
        """,
        foreign_budget_line_id,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_show_id,
        production_lab.data.foreign_season_id,
        production_lab.data.foreign_episode_id,
    )
    episode_id = _episode_id(production_lab)
    foreign_po = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Foreign PO",
            "external_cost": True,
            "budgeted_amount": 100,
            "purchase_order_id": foreign_po_id,
        },
    )
    foreign_work_order = production_lab.client.post(
        "/v1/budget/lines",
        json={"episode_id": episode_id, "category": "Foreign work", "work_order_id": foreign_work_order_id},
    )
    foreign_episode = production_lab.client.get(f"/v1/budget/episodes/{production_lab.data.foreign_episode_id}/summary")
    foreign_show = production_lab.client.get(f"/v1/budget/shows/{production_lab.data.foreign_show_id}/summary")
    foreign_update = production_lab.client.post(
        f"/v1/budget/lines/{foreign_budget_line_id}/manual-actual-adjustments",
        json={"amount": 1, "reason": "Foreign tenant probe must be denied."},
    )

    assert (
        foreign_po.status_code
        == foreign_work_order.status_code
        == foreign_episode.status_code
        == foreign_show.status_code
        == foreign_update.status_code
        == 404
    )


def test_budget_po_overruns_require_an_explanation_and_record_the_authorisation(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    purchase_order_id = _approved_po(production_lab, approved_amount=100)
    missing_reason = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Overrun finishing",
            "external_cost": True,
            "budgeted_amount": 150,
            "purchase_order_id": purchase_order_id,
        },
    )
    approved = production_lab.client.post(
        "/v1/budget/lines",
        json={
            "episode_id": episode_id,
            "category": "Overrun finishing",
            "external_cost": True,
            "budgeted_amount": 150,
            "purchase_order_id": purchase_order_id,
            "overrun_reason": "Client requested a new finishing pass after picture lock.",
        },
    )

    assert missing_reason.status_code == 400
    assert approved.status_code == 201, approved.text
    assert approved.json()["purchase_order"]["remaining_amount"] == -50
    assert (
        production_lab.fetchval(
            """
            SELECT count(*) FROM activity_log
            WHERE organization_id = $1
              AND entity_type = 'purchase_order'
              AND entity_id = $2
              AND action = 'purchase_order.budget_line_overrun_authorised'
            """,
            production_lab.data.organization_id,
            purchase_order_id,
        )
        == 1
    )
