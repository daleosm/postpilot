"""Pure operational-booking rules shared by FastAPI route handlers.

These rules deliberately treat setup and handover as resource-blocking time,
while allowing pencil holds to be non-blocking for confirmed work. Keeping this
logic free of SQL makes the conflict behaviour easy to test independently of a
particular calendar UI.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TypedDict


class BookingWindow(TypedDict):
    room_id: str | None
    person_id: str | None
    starts_at: object
    ends_at: object
    setup_minutes: int
    handover_minutes: int
    status: str
    is_option: bool


def operational_window(window: BookingWindow):
    return (
        window["starts_at"] - timedelta(minutes=window["setup_minutes"]),
        window["ends_at"] + timedelta(minutes=window["handover_minutes"]),
    )


def windows_overlap(first: BookingWindow, second: BookingWindow) -> bool:
    first_start, first_end = operational_window(first)
    second_start, second_end = operational_window(second)
    return first_start < second_end and first_end > second_start


def is_active_option(booking: BookingWindow) -> bool:
    return booking["is_option"] and booking["status"] != "cancelled"


def booking_conflicts(
    existing: list[dict[str, object]], candidate: BookingWindow, *, include_options: bool, exclude_id: str | None = None
) -> list[dict[str, object]]:
    """Return only live resource conflicts with their exact overlapping resource."""
    if candidate["status"] == "cancelled":
        return []
    conflicts: list[dict[str, object]] = []
    for booking in existing:
        if booking.get("id") == exclude_id or booking["status"] == "cancelled":
            continue
        if booking["is_option"] and not include_options:
            continue
        comparison: BookingWindow = {
            "room_id": booking["room_id"],
            "person_id": booking["person_id"],
            "starts_at": booking["starts_at"],
            "ends_at": booking["ends_at"],
            "setup_minutes": int(booking["setup_minutes"]),
            "handover_minutes": int(booking["handover_minutes"]),
            "status": str(booking["status"]),
            "is_option": bool(booking["is_option"]),
        }
        overlaps = [
            resource
            for resource, matches in (
                ("room", candidate["room_id"] and candidate["room_id"] == comparison["room_id"]),
                ("person", candidate["person_id"] and candidate["person_id"] == comparison["person_id"]),
            )
            if matches
        ]
        if overlaps and windows_overlap(candidate, comparison):
            conflicts.append({**booking, "overlaps": overlaps})
    return conflicts


def resequence_options(options: list[dict[str, object]]) -> dict[str, int]:
    """First-created overlapping active holds receive the lowest visible rank."""
    active = sorted(
        (option for option in options if bool(option["is_option"]) and option["status"] != "cancelled"),
        key=lambda option: (option["created_at"], option["id"]),
    )
    return {str(option["id"]): index for index, option in enumerate(active, start=1)}


def nearest_free_slot(candidate: BookingWindow, existing: list[dict[str, object]]):
    """Find the first available time on the selected resources after a conflict."""
    start, end = operational_window(candidate)
    duration = end - start
    resource_bookings = []
    for booking in existing:
        if booking["status"] == "cancelled":
            continue
        same_room = candidate["room_id"] and candidate["room_id"] == booking["room_id"]
        same_person = candidate["person_id"] and candidate["person_id"] == booking["person_id"]
        if same_room or same_person:
            resource_bookings.append(booking)
    if not resource_bookings:
        return None
    next_start = start
    for booking in sorted(resource_bookings, key=lambda item: item["starts_at"]):
        comparison: BookingWindow = {
            "room_id": booking["room_id"],
            "person_id": booking["person_id"],
            "starts_at": booking["starts_at"],
            "ends_at": booking["ends_at"],
            "setup_minutes": int(booking["setup_minutes"]),
            "handover_minutes": int(booking["handover_minutes"]),
            "status": str(booking["status"]),
            "is_option": bool(booking["is_option"]),
        }
        booked_start, booked_end = operational_window(comparison)
        if booked_start < next_start + duration and booked_end > next_start:
            next_start = booked_end
    return {
        "starts_at": next_start + timedelta(minutes=candidate["setup_minutes"]),
        "ends_at": next_start + duration - timedelta(minutes=candidate["handover_minutes"]),
    }
