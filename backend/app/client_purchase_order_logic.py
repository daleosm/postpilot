"""Pure lifecycle and balance rules for client billing authorisations."""

from __future__ import annotations

from decimal import Decimal


def client_po_balances(authorised: Decimal, committed_to_bill: Decimal, invoiced: Decimal) -> dict[str, Decimal]:
    """Calculate receivables balances without touching vendor procurement data."""
    return {
        "authorised_amount": authorised,
        "committed_to_bill_amount": committed_to_bill,
        "invoiced_amount": invoiced,
        "remaining_amount": authorised - committed_to_bill,
        "variance_amount": invoiced - authorised,
    }


def valid_client_po_status_transition(current: str, next_status: str) -> bool:
    if current == next_status:
        return True
    return (current == "draft" and next_status in {"active", "cancelled"}) or (
        current == "active" and next_status in {"closed", "cancelled"}
    )
