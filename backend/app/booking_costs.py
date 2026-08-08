"""Server-side arithmetic for confirmed facility booking actuals."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

FACILITY_DAY_HOURS = Decimal("9")
FACILITY_WEEK_DAYS = Decimal("5")
OVERTIME_MULTIPLIER = Decimal("1.5")


def _duration_hours(start: datetime, end: datetime) -> Decimal:
    """Convert a timedelta to Decimal hours without a float intermediate."""
    duration = end - start
    seconds = Decimal(duration.days * 86_400 + duration.seconds) + (Decimal(duration.microseconds) / Decimal(1_000_000))
    return seconds / Decimal(3_600)


def facility_hours(starts_at: datetime, ends_at: datetime) -> Decimal:
    """Use the facility's 09:00–18:00 day for multi-day actuals.

    Single-day sessions retain their literal duration so approved late-running
    sessions are not silently clipped. Overtime is added separately by the
    caller because it is an explicit operational approval.
    """
    if ends_at <= starts_at:
        return Decimal(0)
    if starts_at.date() == ends_at.date():
        return _duration_hours(starts_at, ends_at)

    first_day_end = starts_at.replace(hour=18, minute=0, second=0, microsecond=0)
    last_day_start = ends_at.replace(hour=9, minute=0, second=0, microsecond=0)
    hours = max(Decimal(0), _duration_hours(starts_at, first_day_end))
    hours += max(Decimal(0), _duration_hours(last_day_start, ends_at))
    cursor = starts_at.replace(hour=9, minute=0, second=0, microsecond=0)
    cursor += timedelta(days=1)
    while cursor < last_day_start:
        hours += FACILITY_DAY_HOURS
        cursor += timedelta(days=1)
    return hours


def normalise_billing_unit(unit: str | None) -> str:
    """Keep legacy and human-friendly unit labels financially equivalent."""
    return (unit or "").strip().lower().replace("-", "_").replace(" ", "_")


def raw_quantity_for_hours(unit: str | None, hours: Decimal) -> Decimal:
    """Convert occupied hours without rounding before a monetary calculation."""
    normalized = normalise_billing_unit(unit)
    if normalized == "hour":
        value = hours
    elif normalized == "half_day":
        value = hours / (FACILITY_DAY_HOURS / Decimal(2))
    elif normalized == "day":
        value = hours / FACILITY_DAY_HOURS
    elif normalized == "week":
        value = hours / (FACILITY_DAY_HOURS * FACILITY_WEEK_DAYS)
    elif normalized in {"fixed", "fixed_fee", "episode", "unit"}:
        value = Decimal(1) if hours > 0 else Decimal(0)
    else:
        # Unknown historic units are treated as fixed rather than inventing a
        # time conversion. New rate-card rows are validated elsewhere.
        value = Decimal(1) if hours > 0 else Decimal(0)
    return value


def quantity_for_hours(unit: str | None, hours: Decimal) -> Decimal:
    """Return a displayable component quantity without affecting money maths."""
    return raw_quantity_for_hours(unit, hours).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def cost_for_hours(rate: Decimal | None, unit: str | None, hours: Decimal) -> Decimal:
    if rate is None or not unit:
        return Decimal(0)
    quantity = raw_quantity_for_hours(unit, hours)
    normalized = normalise_billing_unit(unit)
    if normalized in {"fixed", "fixed_fee", "episode", "unit"}:
        value = rate if quantity else Decimal(0)
    else:
        value = rate * quantity
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def supports_overtime(unit: str | None) -> bool:
    """Fixed, episode and unit prices stay fixed when a session runs late."""
    return normalise_billing_unit(unit) in {"hour", "half_day", "day", "week"}


def confirmed_hours(starts_at: datetime, ends_at: datetime, overtime_minutes: int) -> Decimal:
    return (facility_hours(starts_at, ends_at) + Decimal(overtime_minutes) / Decimal(60)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
