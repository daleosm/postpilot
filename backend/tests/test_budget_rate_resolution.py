from decimal import Decimal

import pytest

from app.budget_rate_resolution import BudgetRateSnapshot


@pytest.mark.parametrize("unit", ["hour", "day", "fixed"])
def test_budget_rate_snapshot_calculates_each_supported_planning_unit(unit: str) -> None:
    snapshot = BudgetRateSnapshot(
        category="Test resource",
        unit=unit,
        quantity=Decimal("2.5"),
        rate=Decimal("48"),
        source="master_rate_card",
        currency="GBP",
        resource_reference="service:test-resource · Test resource",
    )

    assert snapshot.estimate == Decimal("120")
