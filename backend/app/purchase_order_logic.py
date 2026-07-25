"""Pure calculations and lifecycle rules for supplier purchase orders."""

from __future__ import annotations

from decimal import Decimal


def balance_snapshot(authorised: Decimal, committed: Decimal, actual: Decimal) -> dict[str, Decimal]:
    """Calculate, never persist, PO balance figures."""
    return {
        "authorised_amount": authorised,
        "committed_amount": committed,
        "actual_invoiced_amount": actual,
        "remaining_amount": authorised - committed,
        "variance_amount": actual - authorised,
    }


def valid_status_transition(current: str, next_status: str) -> bool:
    if current == next_status:
        return True
    return (current == "draft" and next_status in {"approved", "cancelled"}) or (
        current == "approved" and next_status in {"closed", "cancelled"}
    )
