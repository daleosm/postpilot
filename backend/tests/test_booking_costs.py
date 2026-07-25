from datetime import UTC, datetime
from decimal import Decimal

from app.booking_costs import confirmed_hours, cost_for_hours, facility_hours


def test_confirmed_hours_include_explicit_overtime_without_browser_cost_input() -> None:
    hours = confirmed_hours(
        datetime(2035, 5, 1, 9, tzinfo=UTC),
        datetime(2035, 5, 1, 12, tzinfo=UTC),
        30,
    )

    assert hours == Decimal("3.50")
    assert cost_for_hours(Decimal("900"), "day", hours) == Decimal("350.00")
    assert cost_for_hours(Decimal("50"), "hour", hours) == Decimal("175.00")


def test_multi_day_actuals_use_the_nine_hour_facility_day() -> None:
    starts_at = datetime(2035, 5, 1, 9, tzinfo=UTC)
    ends_at = datetime(2035, 5, 2, 18, tzinfo=UTC)

    assert facility_hours(starts_at, ends_at) == Decimal("18.0")
    assert cost_for_hours(Decimal("900"), "day", facility_hours(starts_at, ends_at)) == Decimal("1800.00")


def test_fixed_and_episode_room_services_are_charged_once() -> None:
    assert cost_for_hours(Decimal("240"), "episode", Decimal("4.5")) == Decimal("240.00")
    assert cost_for_hours(Decimal("240"), "fixed", Decimal("4.5")) == Decimal("240.00")
