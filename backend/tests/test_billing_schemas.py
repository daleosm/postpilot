import pytest
from pydantic import ValidationError

from app.api.schemas import BillableFromWorkOrderRequest, ClientInvoiceIssueRequest


def test_billable_post_request_does_not_accept_a_browser_supplied_price() -> None:
    assert BillableFromWorkOrderRequest(reference="CO-101").reference == "CO-101"
    with pytest.raises(ValidationError):
        BillableFromWorkOrderRequest(amount=100)


def test_invoice_issue_rejects_duplicate_client_po_overrun_reasons() -> None:
    with pytest.raises(ValidationError, match="at most one overrun reason"):
        ClientInvoiceIssueRequest(
            episode_id="episode-1",
            client_po_overruns=[
                {"client_purchase_order_id": "client-po-1", "reason": "First approval reason."},
                {"client_purchase_order_id": "client-po-1", "reason": "Second approval reason."},
            ],
        )
