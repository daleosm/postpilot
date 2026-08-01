"""Server-side arithmetic for confirmed facility booking actuals."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

FACILITY_DAY_HOURS = Decimal("9")

# These are service-rate categories, not role names. A post house can alter
# their rates or use a more-specific rate card without changing this logic.
BOOKING_RATE_DEFINITIONS: dict[str, tuple[str, str]] = {
    "edit": ("Edit suite", "hour"),
    "color": ("Colour", "hour"),
    "mix": ("Audio suite", "hour"),
    "qc": ("QC", "episode"),
    "client_review": ("Edit suite", "hour"),
    "ingest": ("Edit suite", "hour"),
    "conform": ("Online conform", "hour"),
}


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


def cost_for_hours(rate: Decimal | None, unit: str | None, hours: Decimal) -> Decimal:
    if rate is None or not unit:
        return Decimal(0)
    if unit == "hour":
        value = rate * hours
    elif unit == "day":
        value = rate * (hours / FACILITY_DAY_HOURS)
    else:  # episode/fixed services are charged once when time is confirmed.
        value = rate
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def confirmed_hours(starts_at: datetime, ends_at: datetime, overtime_minutes: int) -> Decimal:
    return (facility_hours(starts_at, ends_at) + Decimal(overtime_minutes) / Decimal(60)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
