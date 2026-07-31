"""Pure calculations and lifecycle rules for supplier purchase orders."""

from __future__ import annotations

from decimal import Decimal


def balance_snapshot(authorised: Decimal, committed: Decimal, actual: Decimal) -> dict[str, Decimal]:
    """Calculate, never persist, supplier-PO balance figures.

    Commitments reserve authorised value before a supplier has invoiced. An
    invoice normally settles part of that reserved scope, so it must not be
    subtracted a second time. Actuals beyond the recorded commitments still
    consume authorisation. In other words:

    ``remaining = authorised - open_commitments - supplier_actuals``

    where ``open_commitments = max(commitments - supplier_actuals, 0)``.
    This is equivalent to ``authorised - max(commitments, supplier_actuals)``
    and remains correct for partial invoices and uncommitted supplier costs.
    """
    open_commitments = max(committed - actual, Decimal(0))
    uncommitted_actuals = max(actual - committed, Decimal(0))
    return {
        "authorised_amount": authorised,
        "committed_amount": committed,
        "actual_invoiced_amount": actual,
        "open_commitment_amount": open_commitments,
        "uncommitted_actual_amount": uncommitted_actuals,
        "remaining_amount": authorised - open_commitments - actual,
        "variance_amount": actual - authorised,
    }


def valid_status_transition(current: str, next_status: str) -> bool:
    if current == next_status:
        return True
    return (current == "draft" and next_status in {"approved", "cancelled"}) or (
        current == "approved" and next_status in {"closed", "cancelled"}
    )
