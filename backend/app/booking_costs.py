"""Server-side arithmetic for confirmed facility booking actuals."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

FACILITY_DAY_HOURS = Decimal("9")

# These are service-rate categories, not role names. A post house can alter
# their rates or use a more-specific rate card without changing this logic.
BOOKING_RATE_DEFINITIONS: dict[str, tuple[str, str]] = {
    "edit": ("Edit suite", "day"),
    "color": ("Colour", "day"),
    "mix": ("Audio suite", "day"),
    "qc": ("QC", "episode"),
    "client_review": ("Edit suite", "day"),
    "ingest": ("Edit suite", "day"),
    "conform": ("Online conform", "day"),
}


def facility_hours(starts_at: datetime, ends_at: datetime) -> Decimal:
    """Use the facility's 09:00–18:00 day for multi-day actuals.

    Single-day sessions retain their literal duration so approved late-running
    sessions are not silently clipped. Overtime is added separately by the
    caller because it is an explicit operational approval.
    """
    if ends_at <= starts_at:
        return Decimal(0)
    if starts_at.date() == ends_at.date():
        return Decimal(str((ends_at - starts_at).total_seconds() / 3600))

    first_day_end = starts_at.replace(hour=18, minute=0, second=0, microsecond=0)
    last_day_start = ends_at.replace(hour=9, minute=0, second=0, microsecond=0)
    hours = max(Decimal(0), Decimal(str((first_day_end - starts_at).total_seconds() / 3600)))
    hours += max(Decimal(0), Decimal(str((ends_at - last_day_start).total_seconds() / 3600)))
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
