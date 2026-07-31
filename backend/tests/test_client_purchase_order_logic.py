from decimal import Decimal

from app.client_purchase_order_logic import client_po_balances, valid_client_po_status_transition


def test_client_po_balances_keep_billing_authorisation_separate_from_vendor_spend() -> None:
    assert client_po_balances(Decimal("1000"), Decimal("650"), Decimal("420")) == {
        "authorised_amount": Decimal("1000"),
        "committed_to_bill_amount": Decimal("650"),
        "invoiced_amount": Decimal("420"),
        "open_billable_commitment_amount": Decimal("230"),
        "uncommitted_invoiced_amount": Decimal("0"),
        "remaining_amount": Decimal("350"),
        "variance_amount": Decimal("-580"),
    }


def test_client_po_lifecycle_is_one_way_after_activation() -> None:
    assert valid_client_po_status_transition("draft", "active")
    assert valid_client_po_status_transition("draft", "cancelled")
    assert valid_client_po_status_transition("active", "closed")
    assert valid_client_po_status_transition("active", "cancelled")
    assert not valid_client_po_status_transition("draft", "closed")
    assert not valid_client_po_status_transition("closed", "active")
    assert not valid_client_po_status_transition("cancelled", "draft")
