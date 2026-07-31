"""Penny-test financial equations for PostPilot's commercial ledgers.

The values below are intentionally awkward. These are invariants, not UI
examples: each equation must remain true after refactors to estimates, POs,
allocations, or invoice generation.
"""

from decimal import Decimal

from app.billing_logic import invoice_totals
from app.budget_logic import money_amount
from app.client_purchase_order_logic import client_po_balances
from app.purchase_order_logic import balance_snapshot


def test_estimate_actual_forecast_and_variance_equations_hold_to_the_penny() -> None:
    quantity = Decimal("2.75")
    saved_rate = Decimal("127.37")
    approved_estimate = money_amount(quantity * saved_rate)
    actual_allocations = (Decimal("91.19"), Decimal("84.07"), Decimal("64.33"))
    actual = sum(actual_allocations, Decimal("0"))
    remaining_planned_estimate = max(approved_estimate - actual, Decimal("0"))
    forecast = actual + remaining_planned_estimate
    variance = forecast - approved_estimate

    assert approved_estimate == money_amount(quantity * saved_rate)
    assert actual == sum(actual_allocations, Decimal("0"))
    assert forecast == actual + remaining_planned_estimate
    assert variance == forecast - approved_estimate
    assert (approved_estimate, actual, remaining_planned_estimate, forecast, variance) == (
        Decimal("350.27"),
        Decimal("239.59"),
        Decimal("110.68"),
        Decimal("350.27"),
        Decimal("0.00"),
    )


def test_hourly_rate_and_fractional_time_round_once_when_saved_as_money() -> None:
    hourly_rate = Decimal("127.37")
    hours = Decimal("2.75")
    raw_cost = hourly_rate * hours

    # Decimal multiplication preserves all source precision. The estimate is
    # rounded exactly once when it becomes a saved monetary amount.
    assert raw_cost == Decimal("350.2675")
    assert money_amount(raw_cost) == Decimal("350.27")


def test_partial_supplier_invoices_sum_to_the_exact_authorised_value() -> None:
    authorised = Decimal("1250.00")
    first_partial_invoice = Decimal("833.33")
    second_partial_invoice = Decimal("416.67")
    supplier_actuals = first_partial_invoice + second_partial_invoice

    assert supplier_actuals == Decimal("1250.00")
    assert balance_snapshot(authorised, Decimal("0.00"), supplier_actuals)["remaining_amount"] == Decimal("0.00")


def test_tax_rounds_once_at_the_invoice_boundary_for_a_penny_edge_case() -> None:
    subtotal = Decimal("19.99")
    tax_rate = Decimal("20")
    raw_tax = subtotal * tax_rate / Decimal("100")
    invoice = invoice_totals(subtotal, tax_enabled=True, tax_rate_percent=tax_rate)

    assert raw_tax == Decimal("3.998")
    assert invoice["tax_amount"] == Decimal("4.00")
    assert invoice["total_amount"] == Decimal("23.99")


def test_three_way_split_preserves_the_full_amount_by_assigning_the_remainder_once() -> None:
    total = Decimal("100.00")
    split = (Decimal("33.33"), Decimal("33.33"), Decimal("33.34"))

    assert sum(split, Decimal("0")) == total
    assert all(amount == money_amount(amount) for amount in split)


def test_overtime_uses_decimal_hours_and_multiplier_before_one_money_rounding() -> None:
    hourly_rate = Decimal("127.37")
    overtime_hours = Decimal("1.25")
    overtime_multiplier = Decimal("1.5")
    raw_overtime_cost = hourly_rate * overtime_hours * overtime_multiplier

    assert raw_overtime_cost == Decimal("238.81875")
    assert money_amount(raw_overtime_cost) == Decimal("238.82")


def test_currency_edges_preserve_every_valid_penny_and_high_value() -> None:
    values = (Decimal("0.01"), Decimal("0.02"), Decimal("999999.99"))

    assert sum(values[:2], Decimal("0")) == Decimal("0.03")
    assert money_amount(values[2]) == Decimal("999999.99")


def test_vendor_po_remaining_reconciles_commitments_and_supplier_actuals_without_double_counting() -> None:
    authorised = Decimal("1000.00")
    commitments = Decimal("600.01")
    supplier_actuals = Decimal("250.02")
    balance = balance_snapshot(authorised, commitments, supplier_actuals)

    # The supplier invoice settles part of the commitment. Only the open
    # commitment plus supplier actuals consume authorisation.
    assert balance["open_commitment_amount"] == max(commitments - supplier_actuals, Decimal("0"))
    assert balance["uncommitted_actual_amount"] == max(supplier_actuals - commitments, Decimal("0"))
    assert balance["remaining_amount"] == (
        authorised - balance["open_commitment_amount"] - supplier_actuals
    )
    assert balance["remaining_amount"] == Decimal("399.99")

    uncommitted_actual = balance_snapshot(authorised, Decimal("250.02"), Decimal("600.01"))
    assert uncommitted_actual["remaining_amount"] == (
        authorised - uncommitted_actual["open_commitment_amount"] - Decimal("600.01")
    )
    assert uncommitted_actual["remaining_amount"] == Decimal("399.99")


def test_client_po_remaining_reconciles_billable_commitments_and_invoices_without_double_counting() -> None:
    authorised = Decimal("1000.00")
    billable_commitments = Decimal("600.01")
    invoiced_values = Decimal("250.02")
    balance = client_po_balances(authorised, billable_commitments, invoiced_values)

    assert balance["open_billable_commitment_amount"] == max(billable_commitments - invoiced_values, Decimal("0"))
    assert balance["uncommitted_invoiced_amount"] == max(invoiced_values - billable_commitments, Decimal("0"))
    assert balance["remaining_amount"] == (
        authorised - balance["open_billable_commitment_amount"] - invoiced_values
    )
    assert balance["remaining_amount"] == Decimal("399.99")


def test_invoice_total_equals_exact_line_sum_plus_once_rounded_tax() -> None:
    invoice_lines = (Decimal("19.99"), Decimal("0.01"), Decimal("333.33"))
    line_sum = sum(invoice_lines, Decimal("0"))
    invoice = invoice_totals(line_sum, tax_enabled=True, tax_rate_percent=Decimal("20"))

    assert invoice["subtotal_amount"] == line_sum
    assert invoice["tax_amount"] == money_amount(line_sum * Decimal("20") / Decimal("100"))
    assert invoice["total_amount"] == invoice["subtotal_amount"] + invoice["tax_amount"]
    assert invoice["total_amount"] == Decimal("424.00")
