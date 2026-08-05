from decimal import Decimal

import pytest

from app.booking_costs import BOOKING_RATE_DEFINITIONS
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


def test_qc_bookings_resolve_to_hourly_room_and_artist_rate_cards() -> None:
    assert BOOKING_RATE_DEFINITIONS["qc"] == ("QC", "hour")
