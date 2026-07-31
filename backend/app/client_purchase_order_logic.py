"""Pure lifecycle and balance rules for client billing authorisations."""

from __future__ import annotations

from decimal import Decimal


def client_po_balances(authorised: Decimal, committed_to_bill: Decimal, invoiced: Decimal) -> dict[str, Decimal]:
    """Calculate client-PO balances without double-counting settled billables.

    A billable commitment reserves client PO value until it is invoiced. The
    issued invoice then settles that commitment; an invoice with no matching
    commitment consumes remaining authorisation directly. Therefore:

    ``remaining = authorised - open_billable_commitments - invoiced``

    where ``open_billable_commitments = max(commitments - invoiced, 0)``.
    """
    open_billable_commitments = max(committed_to_bill - invoiced, Decimal(0))
    uncommitted_invoiced = max(invoiced - committed_to_bill, Decimal(0))
    return {
        "authorised_amount": authorised,
        "committed_to_bill_amount": committed_to_bill,
        "invoiced_amount": invoiced,
        "open_billable_commitment_amount": open_billable_commitments,
        "uncommitted_invoiced_amount": uncommitted_invoiced,
        "remaining_amount": authorised - open_billable_commitments - invoiced,
        "variance_amount": invoiced - authorised,
    }


def valid_client_po_status_transition(current: str, next_status: str) -> bool:
    if current == next_status:
        return True
    return (current == "draft" and next_status in {"active", "cancelled"}) or (
        current == "active" and next_status in {"closed", "cancelled"}
    )
