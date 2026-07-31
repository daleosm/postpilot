"""Pure budget ledger calculations shared by the FastAPI budget endpoints."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

MONEY = Decimal("0.01")


def decimal_amount(value: object | None) -> Decimal:
    """Normalize PostgreSQL numerics and API values without float arithmetic."""
    if value is None:
        return Decimal("0")
    if isinstance(value, bool):
        raise ValueError("Boolean values are not monetary amounts.")
    return Decimal(str(value))


def money_amount(value: Decimal | object) -> Decimal:
    """Round one saved or calculated amount at a defined money boundary."""
    return decimal_amount(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def monetary(value: Decimal | object) -> float:
    """Format a final Decimal value for an API response or audit display.

    Business calculations and database writes use :func:`decimal_amount` and
    :class:`Decimal`. This is the explicit outbound presentation boundary; a
    browser must never post this display value back as an authoritative total.
    """
    return float(money_amount(value))


def json_safe(value: object) -> object:
    """Turn Decimal audit values into exact JSON strings at the audit boundary.

    PostgreSQL JSON cannot serialise ``Decimal`` itself. Representing money as
    a string in immutable audit metadata preserves every stored penny and
    avoids reintroducing float conversion solely for logging.
    """
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(item) for item in value]
    return value


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
