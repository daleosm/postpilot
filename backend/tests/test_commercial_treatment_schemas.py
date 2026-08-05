from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.schemas import BookingCreateRequest, WorkOrderCreateRequest


def _window() -> dict[str, object]:
    return {
        "title": "Grade review",
        "starts_at": datetime(2035, 5, 1, 9, tzinfo=UTC),
        "ends_at": datetime(2035, 5, 1, 18, tzinfo=UTC),
    }


def test_booking_treatments_require_only_their_operational_and_commercial_inputs() -> None:
    wet = BookingCreateRequest(**_window(), commercial_treatment="wet_hire", room_id="room-1", person_id="person-1")
    dry = BookingCreateRequest(**_window(), commercial_treatment="dry_hire", room_id="room-1")
    flat = BookingCreateRequest(
        **_window(),
        commercial_treatment="flat_project_fee",
        client_quote_amount="2500.00",
        room_id="room-1",
        person_id="person-1",
    )

    assert wet.commercial_treatment == "wet_hire"
    assert dry.person_id is None
    assert flat.client_quote_amount == 2500

    with pytest.raises(ValidationError, match="Wet hire needs both"):
        BookingCreateRequest(**_window(), commercial_treatment="wet_hire", room_id="room-1")
    with pytest.raises(ValidationError, match="Dry hire needs a room"):
        BookingCreateRequest(**_window(), commercial_treatment="dry_hire")
    with pytest.raises(ValidationError, match="room-only"):
        BookingCreateRequest(**_window(), commercial_treatment="dry_hire", room_id="room-1", person_id="person-1")
    with pytest.raises(ValidationError, match="Flat project fee needs an agreed client price"):
        BookingCreateRequest(**_window(), commercial_treatment="flat_project_fee")


def test_fixed_fee_booking_override_is_limited_to_flat_project_fee() -> None:
    fee = BookingCreateRequest(
        **_window(),
        commercial_treatment="flat_project_fee",
        client_quote_amount="2500.00",
        commercial_overrides=[
            {
                "component_type": "fixed_fee",
                "rate": "2250.00",
                "reason": "Client approved a revised package fee.",
            }
        ],
    )

    assert fee.commercial_overrides[0].component_type == "fixed_fee"
    assert fee.commercial_overrides[0].rate == 2250

    with pytest.raises(ValidationError, match="fixed-fee override"):
        BookingCreateRequest(
            **_window(),
            commercial_treatment="dry_hire",
            room_id="room-1",
            commercial_overrides=[
                {
                    "component_type": "fixed_fee",
                    "rate": "2250.00",
                    "reason": "This must not carry across treatments.",
                }
            ],
        )


def test_work_order_flat_fee_requires_an_agreed_client_price() -> None:
    fee = WorkOrderCreateRequest(
        episode_id="episode-1",
        title="Network revisions package",
        commercial_treatment="flat_project_fee",
        billing_scope="billable_change",
        client_quote_amount="1200.00",
    )
    assert fee.commercial_treatment == "flat_project_fee"

    with pytest.raises(ValidationError, match="Flat project fee needs an agreed client price"):
        WorkOrderCreateRequest(
            episode_id="episode-1",
            title="Network revisions package",
            commercial_treatment="flat_project_fee",
            billing_scope="billable_change",
        )

    with pytest.raises(ValidationError, match="internal client-billable"):
        WorkOrderCreateRequest(
            episode_id="episode-1",
            title="Network revisions package",
            commercial_treatment="flat_project_fee",
            client_quote_amount="1200.00",
        )

    with pytest.raises(ValidationError, match="separate authorised change"):
        WorkOrderCreateRequest(
            episode_id="episode-1",
            title="Network revisions package",
            commercial_treatment="flat_project_fee",
            billing_scope="billable_change",
            client_quote_amount="1200.00",
            allow_overtime_billing=True,
            planned_duration_quantity=1,
            planned_duration_unit="day",
        )
