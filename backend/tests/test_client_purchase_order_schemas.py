import pytest
from pydantic import ValidationError

from app.api.schemas import ClientPurchaseOrderCreateRequest, ClientPurchaseOrderUpdateRequest


def test_client_po_schema_rejects_calculated_fields_and_invalid_dates() -> None:
    with pytest.raises(ValidationError):
        ClientPurchaseOrderCreateRequest(
            client_company_id="client-1",
            po_number="CLIENT-001",
            approved_amount=1000,
            remaining_amount=999,
        )
    with pytest.raises(ValidationError, match="Expiry date cannot be before"):
        ClientPurchaseOrderCreateRequest(
            client_company_id="client-1",
            po_number="CLIENT-001",
            approved_amount=1000,
            issue_date="2035-06-10",
            expiry_date="2035-06-09",
        )


def test_client_po_update_requires_a_meaningful_change() -> None:
    with pytest.raises(ValidationError, match="Provide at least one"):
        ClientPurchaseOrderUpdateRequest()
