from decimal import Decimal

import pytest

from app.api.routes.rate_cards import SUPPORTED_BILLING_UNITS
from app.work_order_billing import overtime_charge, overtime_hourly_base_rate, time_block_hours


def test_time_blocks_use_the_tenant_standard_day_without_float_math() -> None:
    standard_day = Decimal("10")
    assert time_block_hours(Decimal("3"), "day", standard_day) == Decimal("30")
    assert time_block_hours(Decimal("1"), "half_day", standard_day) == Decimal("5.0")
    assert time_block_hours(Decimal("1.5"), "week", standard_day) == Decimal("75.0")


def test_overtime_basis_is_derived_from_agreed_fee_and_snapshotted_to_four_places() -> None:
    base_rate = overtime_hourly_base_rate(Decimal("3000.00"), Decimal("3"), "day", Decimal("10"))
    assert base_rate == Decimal("100.0000")
    assert overtime_charge(overtime_minutes=120, hourly_base_rate=base_rate, multiplier=Decimal("1.5")) == Decimal(
        "300.00"
    )


def test_fixed_fee_has_no_implied_overtime_basis_without_planned_occupancy() -> None:
    with pytest.raises(ValueError, match="hours, half-days, days, or weeks"):
        time_block_hours(Decimal("1"), "fixed", Decimal("10"))


def test_supported_billing_units_include_hourly_and_fixed() -> None:
    assert "hour" in SUPPORTED_BILLING_UNITS
    assert "day" in SUPPORTED_BILLING_UNITS
    assert "fixed" in SUPPORTED_BILLING_UNITS
