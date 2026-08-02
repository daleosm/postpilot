import pytest
from pydantic import ValidationError

from app.api.schemas import WorkOrderCreateRequest, WorkOrderUpdateRequest


def test_client_po_can_only_be_selected_for_quoted_internal_billable_work() -> None:
    base = {"episode_id": "episode-1", "title": "Retitle an endboard", "client_purchase_order_id": "client-po-1"}

    with pytest.raises(ValidationError, match="internal client-billable"):
        WorkOrderCreateRequest(**base, work_type="external_vendor", vendor_company_id="vendor-1")
    with pytest.raises(ValidationError, match="internal client-billable"):
        WorkOrderCreateRequest(**base, billing_scope="included")
    with pytest.raises(ValidationError, match="quoted client amount"):
        WorkOrderCreateRequest(**base, billing_scope="billable_change", client_quote_amount=0)

    request = WorkOrderCreateRequest(**base, billing_scope="billable_change", client_quote_amount=450)
    assert request.client_purchase_order_id == "client-po-1"


def test_work_order_update_rejects_client_po_on_vendor_or_non_billable_work() -> None:
    with pytest.raises(ValidationError, match="internal client-billable"):
        WorkOrderUpdateRequest(client_purchase_order_id="client-po-1", work_type="external_vendor")
    with pytest.raises(ValidationError, match="internal client-billable"):
        WorkOrderUpdateRequest(client_purchase_order_id="client-po-1", billing_scope="included")


def test_work_order_accepts_time_blocks_and_requires_a_real_billable_basis_for_overtime() -> None:
    request = WorkOrderCreateRequest(
        episode_id="episode-1",
        title="Three-day online change",
        billing_scope="billable_change",
        client_quote_amount=3000,
        planned_duration_quantity=3,
        planned_duration_unit="day",
        allow_overtime_billing=True,
        items=[
            {
                "type": "service",
                "description": "Online conform",
                "quantity": 3,
                "unit": "day",
                "unit_rate": 1000,
            },
            {
                "type": "expense",
                "description": "Fixed delivery charge",
                "quantity": 1,
                "unit": "fixed",
                "unit_rate": 50,
            },
        ],
    )
    assert request.planned_duration_unit == "day"
    assert request.items[0].unit == "day"

    with pytest.raises(ValidationError, match="planned occupancy"):
        WorkOrderCreateRequest(
            episode_id="episode-1",
            title="Incomplete overtime work",
            billing_scope="billable_change",
            client_quote_amount=3000,
            allow_overtime_billing=True,
        )
