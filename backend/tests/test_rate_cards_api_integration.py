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
    lab: ProductionApiLab, episode_id: str, *, category: str = "Colourist", unit: str = "day"
) -> dict[str, object]:
    response = lab.client.get(
        "/v1/rate-cards/effective",
        params={"episode_id": episode_id, "category": category, "unit": unit},
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
        unit="day",
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
        unit="day",
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


def test_rate_cards_enforce_commercial_permission_and_tenant_scope(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    service_rate_id = _service(
        production_lab,
        name=f"Python Editor {uuid4().hex[:8]}",
        category="Editor",
        unit="day",
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
        VALUES ($1, $2, 'Foreign Python editor', 'Editor', 'day', 700, 'GBP', true)
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
        params={"episode_id": production_lab.data.foreign_episode_id, "category": "Editor", "unit": "day"},
    )

    assert foreign_service.status_code == foreign_show.status_code == foreign_episode.status_code == 404
