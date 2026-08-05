from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.schemas import BookingCreateRequest, BookingTimeSubmissionRequest


def test_booking_schema_rejects_a_zero_or_negative_operational_window() -> None:
    with pytest.raises(ValidationError, match="Booking end must be after its start"):
        BookingCreateRequest(
            title="Invalid booking",
            starts_at=datetime(2035, 5, 1, 14, tzinfo=UTC),
            ends_at=datetime(2035, 5, 1, 14, tzinfo=UTC),
        )


def test_booking_schema_accepts_hourly_and_multi_day_windows() -> None:
    hourly = BookingCreateRequest(
        title="Hourly conform",
        room_id="room-1",
        person_id="person-1",
        starts_at=datetime(2035, 5, 1, 9, tzinfo=UTC),
        ends_at=datetime(2035, 5, 1, 12, tzinfo=UTC),
    )
    multi_day = BookingCreateRequest(
        title="Multi-day grade",
        room_id="room-1",
        person_id="person-1",
        starts_at=datetime(2035, 5, 1, 9, tzinfo=UTC),
        ends_at=datetime(2035, 5, 3, 18, tzinfo=UTC),
        setup_minutes=30,
        handover_minutes=15,
    )

    assert hourly.ends_at > hourly.starts_at
    assert multi_day.ends_at > multi_day.starts_at


def test_booking_schema_requires_an_episode_for_a_budget_item() -> None:
    with pytest.raises(ValidationError, match="Choose an episode before assigning a budget item"):
        BookingCreateRequest(
            title="Unscoped budget booking",
            room_id="room-1",
            person_id="person-1",
            budget_line_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            starts_at=datetime(2035, 5, 1, 9, tzinfo=UTC),
            ends_at=datetime(2035, 5, 1, 12, tzinfo=UTC),
        )


def test_time_submission_schema_rejects_bad_windows_and_browser_calculated_costs() -> None:
    with pytest.raises(ValidationError, match="Actual end must be after actual start"):
        BookingTimeSubmissionRequest(
            actual_starts_at=datetime(2035, 5, 1, 14, tzinfo=UTC),
            actual_ends_at=datetime(2035, 5, 1, 14, tzinfo=UTC),
        )
    with pytest.raises(ValidationError):
        BookingTimeSubmissionRequest(
            actual_starts_at=datetime(2035, 5, 1, 14, tzinfo=UTC),
            actual_ends_at=datetime(2035, 5, 1, 15, tzinfo=UTC),
            actual_internal_cost=9999,
        )
