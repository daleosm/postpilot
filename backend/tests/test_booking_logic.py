from datetime import UTC, datetime

from app.booking_logic import booking_conflicts, nearest_free_slot, resequence_options, windows_overlap


def booking(**overrides: object) -> dict[str, object]:
    return {
        "id": "booking-a",
        "room_id": "room-a",
        "person_id": "person-a",
        "starts_at": datetime(2035, 5, 1, 10, tzinfo=UTC),
        "ends_at": datetime(2035, 5, 1, 12, tzinfo=UTC),
        "setup_minutes": 15,
        "handover_minutes": 20,
        "status": "confirmed",
        "is_option": False,
        "created_at": datetime(2035, 4, 1, 10, tzinfo=UTC),
        **overrides,
    }


def test_operational_buffers_conflict_even_when_client_facing_times_do_not_overlap() -> None:
    existing = booking()
    candidate = booking(
        id="booking-b",
        starts_at=datetime(2035, 5, 1, 12, 10, tzinfo=UTC),
        ends_at=datetime(2035, 5, 1, 13, tzinfo=UTC),
        setup_minutes=0,
        handover_minutes=0,
    )

    assert windows_overlap(candidate, existing) is True
    assert booking_conflicts([existing], candidate, include_options=False)[0]["overlaps"] == ["room", "person"]


def test_cancelled_bookings_never_block_a_new_booking() -> None:
    candidate = booking(id="booking-b")
    assert booking_conflicts([booking(status="cancelled")], candidate, include_options=False) == []
    assert booking_conflicts([booking()], booking(id="booking-b", status="cancelled"), include_options=False) == []


def test_option_bookings_are_non_blocking_for_a_confirmed_booking() -> None:
    candidate = booking(id="booking-b")
    option = booking(is_option=True, status="tentative")

    assert booking_conflicts([option], candidate, include_options=False) == []
    assert len(booking_conflicts([option], candidate, include_options=True)) == 1


def test_conflict_results_identify_only_resources_that_overlap() -> None:
    candidate = booking(id="booking-b", person_id="person-b")
    conflict = booking(person_id="person-c")

    result = booking_conflicts([conflict], candidate, include_options=False)
    assert result[0]["overlaps"] == ["room"]


def test_option_resequencing_keeps_first_created_active_hold_first() -> None:
    rank = resequence_options(
        [
            booking(id="second", is_option=True, status="tentative", created_at=datetime(2035, 4, 2, tzinfo=UTC)),
            booking(id="first", is_option=True, status="tentative", created_at=datetime(2035, 4, 1, tzinfo=UTC)),
            booking(id="withdrawn", is_option=True, status="cancelled", created_at=datetime(2035, 3, 1, tzinfo=UTC)),
        ]
    )

    assert rank == {"first": 1, "second": 2}


def test_nearest_free_slot_uses_the_full_operational_window() -> None:
    candidate = booking(
        id="booking-b",
        starts_at=datetime(2035, 5, 1, 10, tzinfo=UTC),
        ends_at=datetime(2035, 5, 1, 11, tzinfo=UTC),
        setup_minutes=15,
        handover_minutes=15,
    )
    slot = nearest_free_slot(candidate, [booking()])

    assert slot == {
        "starts_at": datetime(2035, 5, 1, 12, 35, tzinfo=UTC),
        "ends_at": datetime(2035, 5, 1, 13, 35, tzinfo=UTC),
    }


def test_empty_resource_windows_have_no_conflicts_or_suggested_move() -> None:
    candidate = booking(id="booking-b")

    assert booking_conflicts([], candidate, include_options=False) == []
    assert nearest_free_slot(candidate, []) is None


def test_conflict_check_excludes_the_booking_being_edited() -> None:
    current = booking(id="booking-a")
    edited = booking(id="booking-a", title="Moved title")

    assert booking_conflicts([current], edited, include_options=False, exclude_id="booking-a") == []


def test_room_and_person_may_be_checked_independently() -> None:
    room_only = booking(person_id=None)
    candidate = booking(id="booking-b", person_id="person-b")
    person_only = booking(id="booking-c", room_id=None, person_id="person-b")

    assert booking_conflicts([room_only], candidate, include_options=False)[0]["overlaps"] == ["room"]
    assert booking_conflicts([person_only], candidate, include_options=False)[0]["overlaps"] == ["person"]


def test_multi_day_booking_blocks_an_overlapping_day_in_the_same_gantt_row() -> None:
    multi_day = booking(
        starts_at=datetime(2035, 5, 1, 9, tzinfo=UTC),
        ends_at=datetime(2035, 5, 3, 18, tzinfo=UTC),
        setup_minutes=0,
        handover_minutes=0,
    )
    day_two = booking(
        id="booking-b",
        starts_at=datetime(2035, 5, 2, 9, tzinfo=UTC),
        ends_at=datetime(2035, 5, 2, 18, tzinfo=UTC),
        setup_minutes=0,
        handover_minutes=0,
    )

    assert len(booking_conflicts([multi_day], day_two, include_options=False)) == 1


def test_non_overlapping_resource_time_is_not_a_conflict() -> None:
    morning = booking(setup_minutes=0, handover_minutes=0)
    afternoon = booking(
        id="booking-b",
        starts_at=datetime(2035, 5, 1, 12, tzinfo=UTC),
        ends_at=datetime(2035, 5, 1, 13, tzinfo=UTC),
        setup_minutes=0,
        handover_minutes=0,
    )

    assert booking_conflicts([morning], afternoon, include_options=False) == []
