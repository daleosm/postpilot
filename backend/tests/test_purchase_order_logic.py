from decimal import Decimal

from app.purchase_order_logic import balance_snapshot, valid_status_transition


def test_purchase_order_balances_are_derived_from_the_ledger() -> None:
    balance = balance_snapshot(Decimal("1000"), Decimal("1100"), Decimal("600"))

    assert balance == {
        "authorised_amount": Decimal("1000"),
        "committed_amount": Decimal("1100"),
        "actual_invoiced_amount": Decimal("600"),
        "open_commitment_amount": Decimal("500"),
        "uncommitted_actual_amount": Decimal("0"),
        "remaining_amount": Decimal("-100"),
        "variance_amount": Decimal("-400"),
    }


def test_purchase_order_status_is_one_way_after_approval_or_closure() -> None:
    assert valid_status_transition("draft", "approved")
    assert valid_status_transition("draft", "cancelled")
    assert valid_status_transition("approved", "closed")
    assert valid_status_transition("approved", "cancelled")
    assert not valid_status_transition("closed", "approved")
    assert not valid_status_transition("cancelled", "draft")
