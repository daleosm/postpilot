"""Tenant-safe FastAPI rate-card inheritance tests."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Rate-card FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _service(lab: ProductionApiLab, *, name: str, category: str, unit: str, rate: float) -> str:
    response = lab.client.post(
        "/v1/rate-cards/services",
        json={"name": name, "category": category, "unit": unit, "rate": rate},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _override(
    lab: ProductionApiLab, *, scope: str, service_rate_id: str, rate: float, **target: object
) -> dict[str, object]:
    response = lab.client.post(
        "/v1/rate-cards/overrides",
        json={"scope": scope, "service_rate_id": service_rate_id, "rate": rate, **target},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_show_episode(
    lab: ProductionApiLab,
    *,
    network: str | None,
    client_company_id: str | None,
) -> tuple[str, str]:
    show_id, season_id, episode_id = str(uuid4()), str(uuid4()), str(uuid4())
    lab.execute(
        """
        INSERT INTO shows (id, organization_id, title, code, network, client_company_id, time_zone)
        VALUES ($1, $2, $3, $4, $5, $6, 'Europe/London')
        """,
        show_id,
        lab.data.organization_id,
        f"Python Rate Series {show_id[:8]}",
        f"RT{show_id[:4].upper()}",
        network,
        client_company_id,
    )
    lab.execute(
        "INSERT INTO seasons (id, organization_id, show_id, number) VALUES ($1, $2, $3, 1)",
        season_id,
        lab.data.organization_id,
        show_id,
    )
    lab.execute(
        """
        INSERT INTO episodes (id, organization_id, season_id, number, title, status, workflow_status, qc_status)
        VALUES ($1, $2, $3, 1, 'Python Rate Episode', 'development', 'not_started', 'not_started')
        """,
        episode_id,
        lab.data.organization_id,
        season_id,
    )
    return show_id, episode_id


def _effective(
    lab: ProductionApiLab,
    episode_id: str,
    *,
    category: str = "Colourist",
    unit: str = "hour",
    target_type: str | None = None,
    target_id: str | None = None,
) -> dict[str, object]:
    params: dict[str, str] = {"episode_id": episode_id, "category": category, "unit": unit}
    if target_type:
        params["target_type"] = target_type
    if target_id:
        params["target_id"] = target_id
    response = lab.client.get(
        "/v1/rate-cards/effective",
        params=params,
    )
    assert response.status_code == 200, response.text
    return response.json()["effective_rate"]


def test_rate_cards_resolve_episode_show_network_client_and_master_in_order(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    primary_episode_id = _episode_id(production_lab)
    service_rate_id = _service(
        production_lab,
        name=f"Python Colourist {uuid4().hex[:8]}",
        category="Colourist",
        unit="hour",
        rate=80,
    )
    _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=100)
    _override(
        production_lab,
        scope="client",
        service_rate_id=service_rate_id,
        rate=110,
        client_company_id=production_lab.data.client_company_id,
    )
    _override(production_lab, scope="network", service_rate_id=service_rate_id, rate=120, network="Python Network")
    _override(
        production_lab, scope="show", service_rate_id=service_rate_id, rate=130, show_id=production_lab.data.show_id
    )
    _override(production_lab, scope="episode", service_rate_id=service_rate_id, rate=140, episode_id=primary_episode_id)

    same_show_episode_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO episodes (id, organization_id, season_id, number, title, status, workflow_status, qc_status)
        VALUES ($1, $2, $3, 8, 'Same show inherited rate', 'development', 'not_started', 'not_started')
        """,
        same_show_episode_id,
        production_lab.data.organization_id,
        production_lab.data.season_id,
    )
    _, network_episode_id = _create_show_episode(
        production_lab,
        network="Python Network",
        client_company_id=production_lab.data.client_company_id,
    )
    _, client_episode_id = _create_show_episode(
        production_lab,
        network="Different Network",
        client_company_id=production_lab.data.client_company_id,
    )
    _, master_episode_id = _create_show_episode(production_lab, network=None, client_company_id=None)

    episode_rate = _effective(production_lab, primary_episode_id)
    assert episode_rate["rate"] == 140
    assert episode_rate["currency"] == "GBP"
    assert episode_rate["source"] == "episode_rate_card"
    assert episode_rate["card_id"] and episode_rate["item_id"]
    assert _effective(production_lab, same_show_episode_id)["rate"] == 130
    assert _effective(production_lab, same_show_episode_id)["source"] == "show_rate_card"
    assert _effective(production_lab, network_episode_id)["rate"] == 120
    assert _effective(production_lab, network_episode_id)["source"] == "network_rate_card"
    assert _effective(production_lab, client_episode_id)["rate"] == 110
    assert _effective(production_lab, client_episode_id)["source"] == "client_rate_card"
    assert _effective(production_lab, master_episode_id)["rate"] == 100
    assert _effective(production_lab, master_episode_id)["source"] == "master_rate_card"


def test_rate_card_service_catalogue_fallback_updates_and_override_removal(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    service_rate_id = _service(
        production_lab,
        name=f"Python Audio suite {uuid4().hex[:8]}",
        category="Audio suite",
        unit="hour",
        rate=650,
    )
    assert _effective(production_lab, episode_id, category="Audio suite")["source"] == "facility_rate_card"
    card = _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=700)
    replacement = _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=710)
    assert replacement["id"] == card["id"]
    assert len(replacement["items"]) == 1
    assert replacement["items"][0]["rate"] == 710
    item_id = card["items"][0]["id"]
    assert _effective(production_lab, episode_id, category="Audio suite")["rate"] == 710

    update = production_lab.client.patch(f"/v1/rate-cards/services/{service_rate_id}", json={"rate": 675})
    remove = production_lab.client.delete(f"/v1/rate-cards/items/{item_id}")
    assert update.status_code == 200, update.text
    assert remove.status_code == 204, remove.text
    assert _effective(production_lab, episode_id, category="Audio suite") == {
        "rate": 675,
        "currency": "GBP",
        "source": "facility_rate_card",
        "card_id": None,
        "item_id": service_rate_id,
    }


def test_service_catalogue_accepts_hourly_rates_and_rejects_new_daily_rates(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    rejected = production_lab.client.post(
        "/v1/rate-cards/services",
        json={
            "name": "Legacy daily colour suite",
            "category": "Colour",
            "unit": "day",
            "rate": 900,
        },
    )
    created = production_lab.client.post(
        "/v1/rate-cards/services",
        json={
            "name": "Hourly colour suite",
            "category": "Colour",
            "unit": "hour",
            "rate": 100,
        },
    )

    assert rejected.status_code == 422
    assert created.status_code == 201, created.text
    assert created.json()["unit"] == "hour"


def test_service_catalogue_removal_clears_live_overrides_without_touching_tenant_boundaries(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    category = f"Retired suite {uuid4().hex[:8]}"
    service_rate_id = _service(
        production_lab,
        name=f"Python Retired suite {uuid4().hex[:8]}",
        category=category,
        unit="hour",
        rate=95,
    )
    _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=100)
    _override(
        production_lab,
        scope="show",
        service_rate_id=service_rate_id,
        rate=105,
        show_id=production_lab.data.show_id,
    )
    foreign_service_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO service_rates (id, organization_id, name, category, unit, rate, currency, is_active)
        VALUES ($1, $2, 'Foreign retired suite', 'Foreign suite', 'hour', 95, 'GBP', true)
        """,
        foreign_service_id,
        production_lab.data.foreign_organization_id,
    )

    removed = production_lab.client.delete(f"/v1/rate-cards/services/{service_rate_id}")
    services = production_lab.client.get("/v1/rate-cards/services")
    overrides = production_lab.client.get("/v1/rate-cards/overrides", params={"scope": "master"})
    foreign_remove = production_lab.client.delete(f"/v1/rate-cards/services/{foreign_service_id}")

    assert removed.status_code == 204, removed.text
    assert services.status_code == 200
    assert service_rate_id not in {service["id"] for service in services.json()["service_rates"]}
    assert overrides.status_code == 200
    assert f"{category}:hour" not in overrides.json()["overrides"]
    assert foreign_remove.status_code == 404


def test_master_service_edit_keeps_linked_rate_card_entries_in_sync(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    original_category = f"Original suite {uuid4().hex[:8]}"
    updated_category = f"Updated suite {uuid4().hex[:8]}"
    service_rate_id = _service(
        production_lab,
        name=f"Python renamed suite {uuid4().hex[:8]}",
        category=original_category,
        unit="hour",
        rate=90,
    )
    _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=100)

    edited = production_lab.client.patch(
        f"/v1/rate-cards/services/{service_rate_id}",
        json={"category": updated_category, "unit": "episode"},
    )
    overrides = production_lab.client.get("/v1/rate-cards/overrides", params={"scope": "master"})

    assert edited.status_code == 200, edited.text
    assert edited.json()["category"] == updated_category
    assert edited.json()["unit"] == "episode"
    assert updated_category + ":episode" in overrides.json()["overrides"]
    assert original_category + ":hour" not in overrides.json()["overrides"]


def test_rate_cards_enforce_commercial_permission_and_tenant_scope(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    service_rate_id = _service(
        production_lab,
        name=f"Python Editor {uuid4().hex[:8]}",
        category="Editor",
        unit="hour",
        rate=500,
    )
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/rate-cards").status_code == 403
    assert (
        production_lab.client.post(
            "/v1/rate-cards/overrides",
            json={"scope": "master", "service_rate_id": service_rate_id, "rate": 600},
        ).status_code
        == 403
    )

    production_lab.sign_out()
    production_lab.sign_in_as_manager()
    foreign_service_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO service_rates (id, organization_id, name, category, unit, rate, currency, is_active)
        VALUES ($1, $2, 'Foreign Python editor', 'Editor', 'hour', 700, 'GBP', true)
        """,
        foreign_service_id,
        production_lab.data.foreign_organization_id,
    )
    foreign_service = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={"scope": "master", "service_rate_id": foreign_service_id, "rate": 700},
    )
    foreign_show = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "show",
            "show_id": production_lab.data.foreign_show_id,
            "service_rate_id": service_rate_id,
            "rate": 700,
        },
    )
    foreign_episode = production_lab.client.get(
        "/v1/rate-cards/effective",
        params={"episode_id": production_lab.data.foreign_episode_id, "category": "Editor", "unit": "hour"},
    )

    assert foreign_service.status_code == foreign_show.status_code == foreign_episode.status_code == 404


def test_named_artist_rates_are_explicit_scoped_and_fall_back_to_generic_services(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    service_rate_id = _service(
        production_lab,
        name=f"Generic colourist {uuid4().hex[:8]}",
        category="Colourist",
        unit="hour",
        rate=100,
    )
    master = _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=125)
    initial_people = [item for item in master["items"] if item["target_type"] == "person"]
    assert initial_people == []

    named = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "master",
            "target_type": "person",
            "person_id": production_lab.data.colorist_person_id,
            "category": "Colourist",
            "unit": "hour",
            "rate": 175,
            "internal_cost_rate": 95,
        },
    )
    assert named.status_code == 201, named.text
    person_item = next(item for item in named.json()["items"] if item["target_type"] == "person")
    assert person_item["person_id"] == production_lab.data.colorist_person_id
    assert person_item["client_rate"] == 175
    assert person_item["internal_cost_rate"] == 95

    # A generic service at show scope wins over the broader master person rate;
    # an exact artist row at the same show scope then wins over that generic.
    _override(
        production_lab,
        scope="show",
        service_rate_id=service_rate_id,
        rate=150,
        show_id=production_lab.data.show_id,
    )
    generic = _effective(
        production_lab,
        episode_id,
        target_type="person",
        target_id=production_lab.data.colorist_person_id,
    )
    assert generic["rate"] == 150
    assert generic["source"] == "show_rate_card"
    exact = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "show",
            "show_id": production_lab.data.show_id,
            "target_type": "person",
            "person_id": production_lab.data.colorist_person_id,
            "category": "Colourist",
            "unit": "hour",
            "rate": 190,
            "internal_cost_rate": 105,
        },
    )
    assert exact.status_code == 201, exact.text
    resolved = _effective(
        production_lab,
        episode_id,
        target_type="person",
        target_id=production_lab.data.colorist_person_id,
    )
    assert resolved["rate"] == 190
    assert resolved["internal_cost_rate"] == 105
    assert resolved["target_type"] == "person"
    assert resolved["person_id"] == production_lab.data.colorist_person_id

    room = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "show",
            "show_id": production_lab.data.show_id,
            "target_type": "room",
            "room_id": production_lab.data.room_id,
            "category": "Colour suite",
            "unit": "hour",
            "rate": 240,
            "internal_cost_rate": 115,
        },
    )
    assert room.status_code == 201, room.text
    room_resolved = _effective(
        production_lab,
        episode_id,
        category="Colour suite",
        target_type="room",
        target_id=production_lab.data.room_id,
    )
    assert room_resolved["rate"] == 240
    assert room_resolved["internal_cost_rate"] == 115
    assert room_resolved["target_type"] == "room"
    assert room_resolved["room_id"] == production_lab.data.room_id


def test_named_artist_rate_targets_are_tenant_scoped_and_idempotent(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    payload = {
        "scope": "master",
        "target_type": "person",
        "person_id": production_lab.data.editor_person_id,
        "category": "Editor",
        "unit": "hour",
        "rate": 160,
    }
    created = production_lab.client.post("/v1/rate-cards/overrides", json=payload)
    updated = production_lab.client.post("/v1/rate-cards/overrides", json={**payload, "rate": 165})
    assert created.status_code == updated.status_code == 201
    artist_items = [item for item in updated.json()["items"] if item["target_type"] == "person"]
    assert len(artist_items) == 1
    assert artist_items[0]["rate"] == 165

    foreign = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={**payload, "person_id": production_lab.data.foreign_person_id},
    )
    assert foreign.status_code == 404
    foreign_lookup = production_lab.client.get(
        "/v1/rate-cards/effective",
        params={
            "episode_id": _episode_id(production_lab),
            "category": "Editor",
            "unit": "hour",
            "target_type": "person",
            "target_id": production_lab.data.foreign_person_id,
        },
    )
    assert foreign_lookup.status_code == 404


def test_named_artist_rate_beats_generic_rate_at_a_peer_network_or_client_scope(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    service_rate_id = _service(
        production_lab,
        name=f"Peer scope colourist {uuid4().hex[:8]}",
        category="Colourist",
        unit="hour",
        rate=100,
    )
    # Both scopes apply to this episode. The named client exception must win
    # before the resolver considers the network's generic service price.
    _override(
        production_lab,
        scope="network",
        service_rate_id=service_rate_id,
        rate=150,
        network="Peer scope network",
    )
    named_client = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "client",
            "client_company_id": production_lab.data.client_company_id,
            "target_type": "person",
            "person_id": production_lab.data.colorist_person_id,
            "category": "Colourist",
            "unit": "hour",
            "rate": 180,
        },
    )
    assert named_client.status_code == 201, named_client.text
    _, episode_id = _create_show_episode(
        production_lab,
        network="Peer scope network",
        client_company_id=production_lab.data.client_company_id,
    )

    effective = _effective(
        production_lab,
        episode_id,
        target_type="person",
        target_id=production_lab.data.colorist_person_id,
    )
    assert effective["rate"] == 180
    assert effective["source"] == "client_rate_card"
    assert effective["target_type"] == "person"


def test_artist_rate_search_and_scoped_register_are_tenant_safe(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    person = production_lab.fetchrow(
        "SELECT name FROM people WHERE id = $1 AND organization_id = $2",
        production_lab.data.editor_person_id,
        production_lab.data.organization_id,
    )
    assert person
    search = production_lab.client.get("/v1/rate-cards/artists", params={"query": person["name"][:4]})
    assert search.status_code == 200, search.text
    assert any(row["id"] == production_lab.data.editor_person_id for row in search.json()["people"])
    editor_role = next(
        row["role"] for row in search.json()["people"] if row["id"] == production_lab.data.editor_person_id
    )
    assert production_lab.client.get("/v1/rate-cards/artists", params={"query": ""}).json() == {"people": []}

    saved = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "master",
            "target_type": "person",
            "person_id": production_lab.data.editor_person_id,
            "category": "Editor",
            "unit": "hour",
            "rate": 180,
            "internal_cost_rate": 92,
        },
    )
    assert saved.status_code == 201, saved.text
    register = production_lab.client.get("/v1/rate-cards/artist-rates", params={"scope": "master"})
    assert register.status_code == 200, register.text
    assert register.json()["artist_rates"] == [
        {
            "id": next(item["id"] for item in saved.json()["items"] if item["target_type"] == "person"),
            "person": {
                "id": production_lab.data.editor_person_id,
                "name": person["name"],
                "role": editor_role,
            },
            "category": "Editor",
            "unit": "hour",
            "client_rate": 180,
            "internal_cost_rate": 92,
            "currency": "GBP",
        }
    ]

    production_lab.sign_out()
    production_lab.sign_in_as_viewer()
    assert production_lab.client.get("/v1/rate-cards/artists", params={"query": "editor"}).status_code == 403


def test_removing_a_named_artist_rate_restores_the_scoped_generic_fallback(
    production_lab: ProductionApiLab,
) -> None:
    """Artist exceptions are explicit and reversible; deleting one never deletes its fallback."""
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    service_rate_id = _service(
        production_lab,
        name=f"Removal fallback {uuid4().hex[:8]}",
        category="Offline editor",
        unit="hour",
        rate=120,
    )
    _override(production_lab, scope="master", service_rate_id=service_rate_id, rate=120)
    named = production_lab.client.post(
        "/v1/rate-cards/overrides",
        json={
            "scope": "master",
            "target_type": "person",
            "person_id": production_lab.data.editor_person_id,
            "category": "Offline editor",
            "unit": "hour",
            "rate": 180,
            "internal_cost_rate": 90,
        },
    )
    assert named.status_code == 201, named.text
    item_id = next(item["id"] for item in named.json()["items"] if item["target_type"] == "person")
    before = _effective(
        production_lab,
        episode_id,
        category="Offline editor",
        target_type="person",
        target_id=production_lab.data.editor_person_id,
    )
    assert before["rate"] == 180

    removed = production_lab.client.delete(f"/v1/rate-cards/items/{item_id}")
    assert removed.status_code == 204, removed.text
    after = _effective(
        production_lab,
        episode_id,
        category="Offline editor",
        target_type="person",
        target_id=production_lab.data.editor_person_id,
    )
    assert after["rate"] == 120
    assert after["source"] == "master_rate_card"
    assert production_lab.fetchval(
        """
        SELECT count(*)
        FROM rate_card_items
        WHERE organization_id = $1 AND id = $2 AND target_type = 'person'
        """,
        production_lab.data.organization_id,
        item_id,
    ) == 0
    assert production_lab.client.delete(f"/v1/rate-cards/items/{item_id}").status_code == 404
    assert production_lab.fetchval(
        """
        SELECT count(*) FROM activity_log
        WHERE organization_id = $1 AND action = 'rate_card.override_removed'
          AND metadata ->> 'itemId' = $2
        """,
        production_lab.data.organization_id,
        item_id,
    ) == 1
