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
