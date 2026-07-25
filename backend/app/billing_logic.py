"""Pure monetary helpers for client billables and invoice readiness."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

MONEY = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    """Round monetary values once, using conventional invoice rounding."""
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def invoice_totals(subtotal: Decimal, *, tax_enabled: bool, tax_rate_percent: Decimal) -> dict[str, Decimal]:
    """Calculate an invoice snapshot without float arithmetic."""
    subtotal = money(subtotal)
    tax_amount = money(subtotal * tax_rate_percent / Decimal("100")) if tax_enabled else Decimal("0.00")
    return {
        "subtotal_amount": subtotal,
        "tax_amount": tax_amount,
        "total_amount": money(subtotal + tax_amount),
    }


def invoice_number_prefix(organization_slug: str) -> str:
    """Return a compact, printable tenant prefix for sequential invoices."""
    prefix = "".join(character for character in organization_slug.upper() if character.isalnum())[:10]
    return prefix or "POSTPILOT"
