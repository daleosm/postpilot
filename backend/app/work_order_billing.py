"""Commercial time-block arithmetic for post-production work orders.

Scheduling and charging are deliberately distinct.  A room booking is the
operational reservation; this module only converts a work order's *planned*
occupancy into a stable hourly basis when the facility has explicitly enabled
client overtime billing.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal


TIME_BLOCK_UNITS = {"hour", "half_day", "day", "week"}
WORK_ORDER_ITEM_UNITS = TIME_BLOCK_UNITS | {"fixed", "unit"}
MONEY = Decimal("0.01")
RATE = Decimal("0.0001")


def time_block_hours(quantity: Decimal, unit: str, standard_day_hours: Decimal) -> Decimal:
    """Return planned occupancy in hours for a billable time block.

    A week is five standard facility days.  ``fixed`` and ``unit`` are valid
    commercial units but have no implied room occupancy and must not be used
    as the basis for an automatic overtime rate.
    """
    if standard_day_hours <= 0:
        raise ValueError("Standard day hours must be greater than zero.")
    multipliers = {
        "hour": Decimal("1"),
        "half_day": Decimal("0.5") * standard_day_hours,
        "day": standard_day_hours,
        "week": Decimal("5") * standard_day_hours,
    }
    if unit not in multipliers:
        raise ValueError("Choose hours, half-days, days, or weeks for planned occupancy.")
    return quantity * multipliers[unit]


def overtime_hourly_base_rate(
    client_quote_amount: Decimal,
    planned_quantity: Decimal,
    planned_unit: str,
    standard_day_hours: Decimal,
) -> Decimal:
    """Derive and snapshot the hidden hourly base from an agreed client fee."""
    hours = time_block_hours(planned_quantity, planned_unit, standard_day_hours)
    if client_quote_amount <= 0 or hours <= 0:
        raise ValueError("An agreed client charge and planned occupancy are required for overtime billing.")
    return (client_quote_amount / hours).quantize(RATE, rounding=ROUND_HALF_UP)


def overtime_charge(
    *, overtime_minutes: int, hourly_base_rate: Decimal | None, multiplier: Decimal | None
) -> Decimal:
    """Calculate one client overtime addition, rounded only at the charge boundary."""
    if overtime_minutes <= 0 or hourly_base_rate is None or multiplier is None:
        return Decimal("0.00")
    if hourly_base_rate < 0 or multiplier <= 0:
        raise ValueError("Overtime billing configuration is invalid.")
    return (
        hourly_base_rate * multiplier * Decimal(overtime_minutes) / Decimal("60")
    ).quantize(MONEY, rounding=ROUND_HALF_UP)
