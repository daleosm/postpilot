"""Confirmed booking commercial snapshots stay server-owned and tenant-safe."""

from __future__ import annotations

import json
import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Booking commercial FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _viewer_person_id(lab: ProductionApiLab) -> str:
    person_id = lab.fetchval(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        lab.data.organization_id,
        lab.data.viewer_user_id,
    )
    assert person_id
    return str(person_id)


def _configure_edit_rates(lab: ProductionApiLab, *, artist_rate: float = 175) -> str:
    service = lab.client.post(
        "/v1/rate-cards/services",
        json={"name": "Commercial edit suite", "category": "Edit suite", "unit": "hour", "rate": 100},
    )
    assert service.status_code == 201, service.text
    generic = lab.client.post(
        "/v1/rate-cards/overrides",
        json={"scope": "master", "service_rate_id": service.json()["id"], "rate": 100},
    )
    assert generic.status_code == 201, generic.text
    artist = lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "master",
            "target_type": "person",
            "person_id": _viewer_person_id(lab),
            "category": "Edit suite",
            "unit": "hour",
            "rate": artist_rate,
            "internal_cost_rate": 90,
        },
    )
    assert artist.status_code == 201, artist.text
    return str(service.json()["id"])


def _booking_payload(lab: ProductionApiLab) -> dict[str, object]:
    return {
        "title": "Commercial editorial booking",
        "episode_id": _episode_id(lab),
        "room_id": lab.data.room_id,
        "person_id": _viewer_person_id(lab),
        "starts_at": "2035-10-01T09:00:00Z",
        "ends_at": "2035-10-01T12:00:00Z",
        "booking_type": "edit",
        "status": "confirmed",
    }


def test_booking_preview_and_confirmation_snapshot_room_and_named_artist_rates(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    _configure_edit_rates(production_lab)
    payload = _booking_payload(production_lab)

    preview = production_lab.client.post("/v1/bookings/commercial-preview", json=payload)
    assert preview.status_code == 200, preview.text
    components = {item["component_type"]: item for item in preview.json()["components"]}
    assert components["room"] == {
        "component_type": "room",
        "resource": "Python Edit Bay",
        "resource_id": production_lab.data.room_id,
        "category": "Edit suite",
        "rate": 100.0,
        "internal_cost_rate": 100.0,
        "unit": "hour",
        "currency": "GBP",
        "source": "master_rate_card",
        "rate_card_scope": "master",
        "source_card_id": components["room"]["source_card_id"],
        "source_card_item_id": components["room"]["source_card_item_id"],
        "estimated_quantity": 3.0,
        "estimated_charge": 300.0,
        "pricing_status": "resolved",
        "is_negotiated_override": False,
        "override_reason": None,
    }
    assert components["person"]["rate"] == 175.0
    assert components["person"]["internal_cost_rate"] == 90.0
    assert components["person"]["estimated_charge"] == 525.0
    assert components["person"]["source"] == "master_rate_card"
    assert components["person"]["rate_card_scope"] == "master"

    # The API ignores any browser-supplied price; only server-resolved rates
    # are persisted when the operational booking is confirmed.
    created = production_lab.client.post("/v1/bookings", json={**payload, "client_rate": 0.01})
    assert created.status_code == 201, created.text
    booking_id = created.json()["id"]
    saved = production_lab.client.get(f"/v1/bookings/{booking_id}/commercial-components")
    assert saved.status_code == 200, saved.text
    saved_components = {item["component_type"]: item for item in saved.json()["components"]}
    assert saved_components["room"]["rate"] == 100.0
    assert saved_components["room"]["estimated_charge"] == 300.0
    assert saved_components["person"]["rate"] == 175.0
    assert saved_components["person"]["estimated_charge"] == 525.0
    assert production_lab.fetchval(
        "SELECT count(*) FROM booking_charge_components WHERE organization_id = $1 AND booking_id = $2",
        production_lab.data.organization_id,
        booking_id,
    ) == 2
    audit_actions = production_lab.fetchval(
        """
        SELECT count(*)
        FROM activity_log
        WHERE organization_id = $1 AND entity_type = 'booking' AND entity_id = $2
          AND action = 'booking.charge_snapshot_created'
        """,
        production_lab.data.organization_id,
        booking_id,
    )
    assert audit_actions == 1

    # A later contract edit is prospective. It never rewrites the saved
    # agreement for an already-confirmed booking.
    updated_artist = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "master",
            "target_type": "person",
            "person_id": _viewer_person_id(production_lab),
            "category": "Edit suite",
            "unit": "hour",
            "rate": 220,
            "internal_cost_rate": 110,
        },
    )
    assert updated_artist.status_code == 201, updated_artist.text
    changed_booking = production_lab.client.patch(
        f"/v1/bookings/{booking_id}", json={**payload, "title": "Retitled booking"}
    )
    assert changed_booking.status_code == 200, changed_booking.text
    unchanged = production_lab.client.get(f"/v1/bookings/{booking_id}/commercial-components")
    assert {item["component_type"]: item for item in unchanged.json()["components"]}["person"]["rate"] == 175.0


def test_booking_uses_the_assigned_artists_role_rate_without_a_named_person_row(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    service = production_lab.client.post(
        "/v1/rate-cards/services",
        json={
            "name": "Production viewer editorial",
            "category": "Editorial artists",
            "artist_role": "production_viewer",
            "unit": "hour",
            "rate": 145,
        },
    )
    assert service.status_code == 201, service.text
    master = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={"scope": "master", "service_rate_id": service.json()["id"], "rate": 145},
    )
    assert master.status_code == 201, master.text

    preview = production_lab.client.post("/v1/bookings/commercial-preview", json=_booking_payload(production_lab))
    assert preview.status_code == 200, preview.text
    person = next(component for component in preview.json()["components"] if component["component_type"] == "person")
    assert person["rate"] == 145.0
    assert person["category"] == "Editorial artists"
    assert person["source"] == "master_rate_card"


def test_pencil_booking_rates_re_resolve_until_confirmation_without_creating_tenant_charges(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    service_id = _configure_edit_rates(production_lab)
    payload = _booking_payload(production_lab)

    pencil_payload = {**payload, "status": "tentative", "is_option": True}
    pencil_preview = production_lab.client.post("/v1/bookings/commercial-preview", json=pencil_payload)
    assert pencil_preview.status_code == 200, pencil_preview.text
    assert {item["component_type"]: item for item in pencil_preview.json()["components"]}["room"]["rate"] == 100.0
    tentative = production_lab.client.post("/v1/bookings", json=pencil_payload)
    assert tentative.status_code == 201, tentative.text
    assert production_lab.client.get(
        f"/v1/bookings/{tentative.json()['id']}/commercial-components"
    ).json()["components"] == []

    updated_master = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={"scope": "master", "service_rate_id": service_id, "rate": 125},
    )
    assert updated_master.status_code == 201, updated_master.text
    refreshed = production_lab.client.post("/v1/bookings/commercial-preview", json=pencil_payload)
    assert {item["component_type"]: item for item in refreshed.json()["components"]}["room"]["rate"] == 125.0

    confirmed = production_lab.client.patch(
        f"/v1/bookings/{tentative.json()['id']}",
        json={**payload, "is_option": False, "status": "confirmed"},
    )
    assert confirmed.status_code == 200, confirmed.text
    snapped = production_lab.client.get(f"/v1/bookings/{tentative.json()['id']}/commercial-components")
    snapped_room = next(item for item in snapped.json()["components"] if item["component_type"] == "room")
    assert snapped_room["rate"] == 125.0
    assert snapped_room["rate_card_scope"] == "master"


def test_confirmed_booking_creation_replays_idempotently_without_duplicate_components(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    _configure_edit_rates(production_lab)
    payload = _booking_payload(production_lab)
    headers = {"Idempotency-Key": f"booking-commercial-{uuid4()}"}

    first = production_lab.client.post("/v1/bookings", json=payload, headers=headers)
    replay = production_lab.client.post("/v1/bookings", json=payload, headers=headers)

    assert first.status_code == replay.status_code == 201
    assert replay.headers["Idempotency-Replayed"] == "true"
    assert replay.json()["id"] == first.json()["id"]
    assert production_lab.fetchval(
        """
        SELECT count(*) FROM booking_charge_components
        WHERE organization_id = $1 AND booking_id = $2
        """,
        production_lab.data.organization_id,
        first.json()["id"],
    ) == 2
    assert production_lab.fetchval(
        "SELECT count(*) FROM bookings WHERE organization_id = $1 AND title = $2",
        production_lab.data.organization_id,
        payload["title"],
    ) == 1


def test_foreign_booking_commercial_selection_is_rejected(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    _configure_edit_rates(production_lab)
    payload = _booking_payload(production_lab)

    foreign = production_lab.client.post(
        "/v1/bookings/commercial-preview",
        json={**payload, "room_id": production_lab.data.foreign_room_id},
    )
    assert foreign.status_code == 404
    assert "post house" in foreign.json()["detail"]


def test_authorised_negotiated_booking_rate_is_reasoned_snapshot_not_a_rate_card_edit(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    _configure_edit_rates(production_lab)
    payload = _booking_payload(production_lab)
    override = {
        "commercial_overrides": [
            {"component_type": "room", "rate": 123.45, "reason": "Client accepted a late-booking suite rate."}
        ]
    }

    preview = production_lab.client.post("/v1/bookings/commercial-preview", json={**payload, **override})
    assert preview.status_code == 200, preview.text
    room_preview = next(item for item in preview.json()["components"] if item["component_type"] == "room")
    assert room_preview["rate"] == 123.45
    assert room_preview["estimated_charge"] == 370.35
    assert room_preview["source"] == "negotiated_booking_override"
    assert room_preview["is_negotiated_override"] is True

    created = production_lab.client.post("/v1/bookings", json={**payload, **override})
    assert created.status_code == 201, created.text
    saved = production_lab.client.get(f"/v1/bookings/{created.json()['id']}/commercial-components")
    saved_room = next(item for item in saved.json()["components"] if item["component_type"] == "room")
    assert saved_room["rate"] == 123.45
    assert saved_room["source"] == "negotiated_booking_override"
    assert saved_room["is_negotiated_override"] is True
    assert saved_room["override_reason"] == "Client accepted a late-booking suite rate."
    override_audit = production_lab.fetchrow(
        """
        SELECT metadata
        FROM activity_log
        WHERE organization_id = $1 AND entity_type = 'booking' AND entity_id = $2
          AND action = 'booking.price_override_approved'
        """,
        production_lab.data.organization_id,
        created.json()["id"],
    )
    assert override_audit
    override_components = json.loads(override_audit["metadata"])["components"]
    assert override_components[0]["reason"] == "Client accepted a late-booking suite rate."

    # The card remains £100/hr: the negotiated rate belongs only to this
    # booking component and cannot reprice later bookings or the contract.
    effective = production_lab.client.get(
        "/v1/rate-cards/effective",
        params={
            "episode_id": payload["episode_id"],
            "category": "Edit suite",
            "unit": "hour",
            "target_type": "room",
            "target_id": payload["room_id"],
        },
    )
    assert effective.status_code == 200, effective.text
    assert effective.json()["effective_rate"]["rate"] == 100.0

    # A production user without the commercial capability cannot submit the
    # controlled exception, even though they can otherwise work in bookings.
    production_lab.execute(
        """
        UPDATE organization_role_policies
        SET permissions = permissions - 'manage_commercial'
        WHERE organization_id = $1 AND role = 'production_manager'
        """,
        production_lab.data.organization_id,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_manager()
    denied = production_lab.client.post("/v1/bookings/commercial-preview", json={**payload, **override})
    assert denied.status_code == 403


def test_negotiated_booking_rate_requires_reason_and_must_be_set_while_confirming(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    _configure_edit_rates(production_lab)
    payload = _booking_payload(production_lab)
    missing_reason = production_lab.client.post(
        "/v1/bookings/commercial-preview",
        json={**payload, "commercial_overrides": [{"component_type": "person", "rate": 190, "reason": ""}]},
    )
    assert missing_reason.status_code == 422
    hold = production_lab.client.post(
        "/v1/bookings/commercial-preview",
        json={
            **payload,
            "status": "hold",
            "commercial_overrides": [
                {"component_type": "person", "rate": 190, "reason": "Client requested a held artist rate."}
            ],
        },
    )
    assert hold.status_code == 409
