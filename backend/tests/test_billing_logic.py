from decimal import Decimal

from app.billing_logic import invoice_number_prefix, invoice_totals


def test_invoice_totals_round_once_and_support_optional_tax() -> None:
    assert invoice_totals(Decimal("100.005"), tax_enabled=True, tax_rate_percent=Decimal("20")) == {
        "subtotal_amount": Decimal("100.01"),
        "tax_amount": Decimal("20.00"),
        "total_amount": Decimal("120.01"),
    }
    assert invoice_totals(Decimal("100"), tax_enabled=False, tax_rate_percent=Decimal("20"))["tax_amount"] == Decimal(
        "0.00"
    )


def test_invoice_prefix_uses_a_compact_tenant_slug_with_safe_fallback() -> None:
    assert invoice_number_prefix("Copperline Post!") == "COPPERLINE"
    assert invoice_number_prefix("---") == "POSTPILOT"
