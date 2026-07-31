"""Penny tests: invariants for every commercial hand-off.

These tests deliberately use awkward decimal values. They protect the rules
that prevent a one-penny drift becoming an incorrect client invoice:

* API inputs become Decimal values before application logic sees them;
* monetary fields accept no fractional pennies;
* planned rates, actual allocations, and invoice totals round only at their
  defined persistence/snapshot boundary; and
* persisted money columns have a single, adequate scale and precision.
"""

from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.schemas import (
    BudgetLineCreateRequest,
    ClientPurchaseOrderAllocationRequest,
    InvoiceSettingsUpdateRequest,
    PurchaseOrderCreateRequest,
    WorkOrderItemRequest,
)
from app.billing_logic import invoice_totals
from app.booking_costs import cost_for_hours, facility_hours
from app.budget_logic import cost_totals, decimal_amount, json_safe, monetary, money_amount
from app.budget_rate_resolution import BudgetRateSnapshot
from app.db.tables import catering_requests, people


def test_money_api_fields_normalise_json_numbers_to_decimal_without_binary_drift() -> None:
    order = PurchaseOrderCreateRequest(
        vendor_company_id="vendor-1",
        po_number="PENNY-001",
        approved_amount=0.1,
    )
    line = BudgetLineCreateRequest(
        episode_id="episode-1",
        category="Sound",
        budgeted_amount="19.99",
    )
    item = WorkOrderItemRequest(
        type="service",
        description="Conform support",
        quantity=Decimal("2.5"),
        unit="hour",
        unit_rate=0.1,
    )

    assert order.approved_amount == Decimal("0.1")
    assert line.budgeted_amount == Decimal("19.99")
    assert item.unit_rate == Decimal("0.1")
    assert isinstance(order.approved_amount, Decimal)
    assert isinstance(line.budgeted_amount, Decimal)
    assert isinstance(item.quantity, Decimal)


@pytest.mark.parametrize("amount", ["10.001", 10.001, Decimal("10.001")])
def test_money_api_fields_reject_fractional_pennies(amount: object) -> None:
    with pytest.raises(ValidationError, match="no more than two decimal places"):
        PurchaseOrderCreateRequest(vendor_company_id="vendor-1", po_number="PENNY-002", approved_amount=amount)


def test_allocation_input_is_decimal_and_cannot_silently_gain_or_lose_a_penny() -> None:
    allocation = ClientPurchaseOrderAllocationRequest(
        allocation_type="change_order",
        change_order_reference="CO-100",
        amount="833.33",
        allocation_date="2035-05-01",
    )
    assert allocation.amount == Decimal("833.33")
    assert allocation.amount + Decimal("416.67") == Decimal("1250.00")


def test_quantities_and_tax_rates_reject_precision_the_database_cannot_store_exactly() -> None:
    with pytest.raises(ValidationError, match="quantity with no more than 2 decimal places"):
        WorkOrderItemRequest(
            type="service",
            description="Conform support",
            quantity="2.001",
            unit="hour",
            unit_rate="100.00",
        )
    with pytest.raises(ValidationError, match="percentage with no more than 3 decimal places"):
        InvoiceSettingsUpdateRequest(
            legal_name="Penny Test Post",
            tax_name="VAT",
            tax_rate_percent="20.1234",
            payment_terms_days=30,
        )


def test_saved_rate_and_planned_estimate_round_once_at_the_snapshot_boundary() -> None:
    snapshot = BudgetRateSnapshot(
        category="Colour",
        unit="hour",
        quantity=Decimal("2.75"),
        rate=Decimal("127.37"),
        source="master_rate_card",
        currency="GBP",
        resource_reference="service:colour · Colour",
    )

    # 2.75 × 127.37 is 350.2675. The displayed/persisted estimate is one
    # rounded monetary snapshot, rather than a float rounded repeatedly.
    assert snapshot.estimate == Decimal("350.27")
    assert money_amount(snapshot.quantity * snapshot.rate) == Decimal("350.27")
    assert Decimal(str(monetary(snapshot.quantity * snapshot.rate))) == Decimal("350.27")


def test_actual_time_and_invoice_handoffs_keep_exact_decimal_totals() -> None:
    starts = datetime(2035, 5, 1, 9, 0)
    ends = datetime(2035, 5, 1, 11, 30)
    hours = facility_hours(starts, ends)
    actual_cost = cost_for_hours(Decimal("127.37"), "hour", hours)
    invoice = invoice_totals(actual_cost, tax_enabled=True, tax_rate_percent=Decimal("20"))

    assert hours == Decimal("2.5")
    assert actual_cost == Decimal("318.43")
    assert invoice == {
        "subtotal_amount": Decimal("318.43"),
        "tax_amount": Decimal("63.69"),
        "total_amount": Decimal("382.12"),
    }


def test_budget_rollup_is_decimal_additive_and_never_uses_cached_po_commitment_as_spend() -> None:
    class Line:
        def __init__(self, budgeted_amount: str, actual_amount: str, external_cost: bool) -> None:
            self.budgeted_amount = Decimal(budgeted_amount)
            self.actual_amount = Decimal(actual_amount)
            self.external_cost = external_cost

    totals = cost_totals(
        [
            Line("100.00", "33.33", False),
            Line("250.00", "166.67", True),
        ]
    )

    assert totals["estimated_amount"] == Decimal("350.00")
    assert totals["actual_amount"] == Decimal("200.00")
    assert totals["variance_amount"] == Decimal("-150.00")
    assert decimal_amount(0.1) + decimal_amount(0.2) == Decimal("0.3")


def test_audit_metadata_preserves_decimal_money_as_text_instead_of_coercing_to_float() -> None:
    assert json_safe({"amount": Decimal("300.00"), "nested": [Decimal("0.10")]}) == {
        "amount": "300.00",
        "nested": ["0.10"],
    }


def test_all_persisted_money_columns_use_numeric_14_2_or_higher() -> None:
    for column in (
        people.c.hourly_rate,
        people.c.day_rate,
        catering_requests.c.actual_cost,
        catering_requests.c.billed_amount,
    ):
        assert column.type.precision >= 14
        assert column.type.scale == 2


def test_money_precision_migration_is_lossless_and_does_not_shrink_on_downgrade() -> None:
    root = Path(__file__).resolve().parents[2]
    migration = (root / "backend/alembic/versions/20260731_10_standardize_money_precision.py").read_text()

    assert "sa.Numeric(14, 2)" in migration
    assert "postgresql_using" in migration
    assert "shrinking a money column could" in migration
