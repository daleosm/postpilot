"""Pure budget ledger calculations shared by the FastAPI budget endpoints."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal


def decimal_amount(value: object | None) -> Decimal:
    """Normalize PostgreSQL numerics and API values without float arithmetic."""
    return Decimal(str(value or 0))


def monetary(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def cost_totals(lines: Iterable[object]) -> dict[str, Decimal]:
    """Return cost-ledger totals without mixing PO commitments into actuals.

    A purchase-order allocation is an authorisation/commitment record.  It is
    deliberately not added to actual spend: doing so would double count the
    same vendor cost once a supplier invoice is entered.
    """
    totals = {
        "estimated_amount": Decimal(0),
        "actual_amount": Decimal(0),
        "internal_estimated_amount": Decimal(0),
        "internal_actual_amount": Decimal(0),
        "external_estimated_amount": Decimal(0),
        "external_actual_amount": Decimal(0),
    }
    for line in lines:
        estimated = decimal_amount(line.budgeted_amount)
        actual = decimal_amount(line.actual_amount)
        totals["estimated_amount"] += estimated
        totals["actual_amount"] += actual
        prefix = "external" if line.external_cost else "internal"
        totals[f"{prefix}_estimated_amount"] += estimated
        totals[f"{prefix}_actual_amount"] += actual
    totals["variance_amount"] = totals["actual_amount"] - totals["estimated_amount"]
    return totals


def can_commit_po(
    *, approved_amount: Decimal, existing_committed: Decimal, replacing_amount: Decimal, next_amount: Decimal
) -> Decimal:
    """Return the post-change overrun amount; zero means it fits the PO."""
    next_committed = existing_committed - replacing_amount + next_amount
    return max(Decimal(0), next_committed - approved_amount)
