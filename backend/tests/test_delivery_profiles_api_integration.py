"""FastAPI equivalents for tenant-safe delivery-profile operations.

These cases port the server side of the former Playwright delivery-profile
suite. They deliberately create profile data in two post houses and assert
against the live PostgreSQL rows to prove profile snapshots do not drift.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Delivery-profile FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _profile_payload(lab: ProductionApiLab, **overrides: object) -> dict[str, object]:
    return {
        "name": "Python network delivery",
        "client_company_id": lab.data.client_company_id,
        "network": "Python Network",
        "show_id": lab.data.show_id,
        "specification_url": "https://specs.postpilot.test/python-network",
        "is_active": True,
        **overrides,
    }


def _profile_item_payload(lab: ProductionApiLab, **overrides: object) -> dict[str, object]:
    return {
        "component_type": "master",
        "label": "ProRes master",
        "required": True,
        "format_specification": "ProRes 422 HQ",
        "version": "TX v1",
        "territory": "UK",
        "language": "English",
        "recipient_contact_id": lab.data.technical_contact_id,
        "requires_external_recipient": True,
        "qc_required": True,
        "default_deadline_offset_days": 0,
        "position": 1,
        **overrides,
    }


def _create_profile(lab: ProductionApiLab, **overrides: object) -> str:
    response = lab.client.post("/v1/delivery-profiles", json=_profile_payload(lab, **overrides))
    assert response.status_code == 201, response.text
    return response.json()["profile"]["id"]


def test_delivery_profile_mutations_require_the_delivery_capability(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_viewer()

    create = production_lab.client.post("/v1/delivery-profiles", json=_profile_payload(production_lab))
    update = production_lab.client.patch(
        f"/v1/delivery-profiles/{production_lab.data.delivery_profile_id}", json={"name": "Not allowed"}
    )
    item = production_lab.client.post(
        f"/v1/delivery-profiles/{production_lab.data.delivery_profile_id}/items",
        json=_profile_item_payload(production_lab),
    )

    assert create.status_code == update.status_code == item.status_code == 403


def test_delivery_profiles_validate_tenant_local_scope_and_names(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    profile_id = _create_profile(production_lab)

    duplicate = production_lab.client.post("/v1/delivery-profiles", json=_profile_payload(production_lab))
    bad_url = production_lab.client.post(
        "/v1/delivery-profiles", json=_profile_payload(production_lab, name="Bad specification", specification_url="no")
    )
    foreign_client = production_lab.client.post(
        "/v1/delivery-profiles",
        json=_profile_payload(
            production_lab, name="Foreign client", client_company_id=production_lab.data.foreign_company_id
        ),
    )
    mismatched_network = production_lab.client.post(
        "/v1/delivery-profiles",
        json=_profile_payload(production_lab, name="Wrong network", network="Different Network"),
    )
    foreign_show = production_lab.client.post(
        "/v1/delivery-profiles",
        json=_profile_payload(production_lab, name="Foreign show", show_id=production_lab.data.foreign_show_id),
    )
    foreign_read = production_lab.client.get(f"/v1/delivery-profiles/{production_lab.data.foreign_delivery_profile_id}")

    assert production_lab.client.get(f"/v1/delivery-profiles/{profile_id}").status_code == 200
    assert duplicate.status_code == 409
    assert bad_url.status_code == 422
    assert foreign_client.status_code == foreign_show.status_code == foreign_read.status_code == 404
    assert mismatched_network.status_code == 409


def test_delivery_profile_items_validate_recipient_position_and_tenant_scope(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    profile_id = _create_profile(production_lab)
    master = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items", json=_profile_item_payload(production_lab)
    )
    assert master.status_code == 201, master.text
    master_id = master.json()["item"]["id"]

    duplicate_position = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items",
        json=_profile_item_payload(production_lab, component_type="captions", label="Captions"),
    )
    invalid_offset = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items",
        json=_profile_item_payload(
            production_lab, component_type="captions", label="Bad offset", position=2, default_deadline_offset_days=3651
        ),
    )
    rejected_recipient = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items",
        json=_profile_item_payload(
            production_lab,
            component_type="metadata",
            label="Unrelated recipient",
            position=2,
            recipient_contact_id=production_lab.data.vendor_contact_id,
        ),
    )
    foreign_recipient = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items",
        json=_profile_item_payload(
            production_lab,
            component_type="metadata",
            label="Foreign recipient",
            position=2,
            recipient_contact_id=production_lab.data.foreign_contact_id,
        ),
    )
    captions = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items",
        json=_profile_item_payload(
            production_lab,
            component_type="captions",
            label="English captions",
            position=2,
            recipient_contact_id=production_lab.data.network_contact_id,
            qc_required=False,
        ),
    )
    assert captions.status_code == 201, captions.text
    captions_id = captions.json()["item"]["id"]
    colliding_edit = production_lab.client.patch(
        f"/v1/delivery-profiles/{profile_id}/items/{captions_id}", json={"position": 1}
    )
    update = production_lab.client.patch(
        f"/v1/delivery-profiles/{profile_id}/items/{master_id}",
        json={"label": "ProRes master v2", "default_deadline_offset_days": -1},
    )
    foreign_profile = production_lab.client.post(
        f"/v1/delivery-profiles/{production_lab.data.foreign_delivery_profile_id}/items",
        json=_profile_item_payload(production_lab, position=3),
    )

    assert duplicate_position.status_code == colliding_edit.status_code == 409
    assert invalid_offset.status_code == 422
    assert rejected_recipient.status_code == foreign_recipient.status_code == 409
    assert update.status_code == 200
    assert foreign_profile.status_code == 404


def test_apply_delivery_profile_copies_a_stable_episode_snapshot(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    profile_id = _create_profile(production_lab)
    item = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items",
        json=_profile_item_payload(production_lab, default_deadline_offset_days=-1),
    )
    assert item.status_code == 201, item.text
    item_id = item.json()["item"]["id"]
    episode_id = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]
    production_lab.execute(
        "UPDATE episodes SET delivery_deadline = $1 WHERE id = $2",
        datetime(2035, 8, 20, 17, tzinfo=UTC),
        episode_id,
    )

    applied = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-manifest/apply",
        json={"delivery_profile_id": profile_id, "reason": "Network delivery requirements confirmed."},
    )
    assert applied.status_code == 200, applied.text
    snapshot = production_lab.fetchrow(
        "SELECT label, due_date::text FROM episode_delivery_items WHERE episode_id = $1 ORDER BY position LIMIT 1",
        episode_id,
    )
    assert snapshot and dict(snapshot) == {"label": "ProRes master", "due_date": "2035-08-19"}

    edited = production_lab.client.patch(
        f"/v1/delivery-profiles/{profile_id}/items/{item_id}", json={"label": "Changed after apply"}
    )
    inactive = _create_profile(production_lab, name=f"Inactive {uuid4().hex[:8]}", is_active=False)
    denied_inactive = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-manifest/apply",
        json={"delivery_profile_id": inactive, "reason": "Must not apply inactive profiles."},
    )
    unchanged = production_lab.fetchval(
        "SELECT label FROM episode_delivery_items WHERE episode_id = $1 ORDER BY position LIMIT 1", episode_id
    )

    assert edited.status_code == 200
    assert unchanged == "ProRes master"
    assert denied_inactive.status_code == 404


def test_delivery_transition_enforces_lifecycle_evidence_and_records_a_correction(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    profile_id = _create_profile(production_lab)
    item = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items", json=_profile_item_payload(production_lab)
    )
    assert item.status_code == 201, item.text
    episode_id = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]
    applied = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-manifest/apply",
        json={"delivery_profile_id": profile_id, "reason": "Apply the controlled delivery requirement."},
    )
    assert applied.status_code == 200, applied.text
    delivery_item_id = production_lab.fetchval(
        "SELECT id::text FROM episode_delivery_items WHERE episode_id = $1 ORDER BY position LIMIT 1", episode_id
    )
    assert delivery_item_id

    def transition(next_status: str, **values: object):
        return production_lab.client.post(
            f"/v1/episodes/{episode_id}/delivery-items/{delivery_item_id}/transition",
            json={"status": next_status, "reason": f"Move item to {next_status}.", **values},
        )

    assert transition("preparing").status_code == 200
    assert transition("ready_for_qc").status_code == 200
    assert transition("dispatched", external_reference="TRANSFER-001").status_code == 409
    assert transition("qc_passed").status_code == 200
    missing_evidence = transition("dispatched")
    dispatched = transition("dispatched", external_reference="TRANSFER-001")
    duplicate = transition("dispatched", external_reference="TRANSFER-001")
    rejected = transition("rejected")

    assert missing_evidence.status_code == 409
    assert dispatched.status_code == 200
    assert duplicate.status_code == 409
    assert rejected.status_code == 200
    correction = production_lab.fetchrow(
        """
        SELECT kind, status, is_blocking FROM post_work_orders
        WHERE organization_id = $1 AND delivery_item_id = $2
        """,
        production_lab.data.organization_id,
        delivery_item_id,
    )
    assert correction and dict(correction) == {"kind": "delivery_correction", "status": "open", "is_blocking": True}
    action = production_lab.fetchval(
        """
        SELECT action FROM activity_log
        WHERE organization_id = $1 AND entity_id = $2
        ORDER BY created_at DESC LIMIT 1
        """,
        production_lab.data.organization_id,
        delivery_item_id,
    )
    assert action == "episode_delivery_item.rejected"


def test_episode_delivery_item_overrides_are_audited_and_do_not_escape_the_episode(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    profile_id = _create_profile(production_lab, name=f"Empty delivery profile {uuid4().hex[:8]}")
    episode_id = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]
    assert (
        production_lab.client.post(
            f"/v1/episodes/{episode_id}/delivery-manifest/apply",
            json={"delivery_profile_id": profile_id, "reason": "Configure an episode-specific delivery exception."},
        ).status_code
        == 200
    )
    first = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-items",
        json={
            "component_type": "metadata",
            "label": "Episode metadata sheet",
            "required": True,
            "recipient_contact_id": production_lab.data.technical_contact_id,
            "requires_external_recipient": True,
            "reason": "The network needs episode metadata.",
        },
    )
    second = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-items",
        json={
            "component_type": "captions",
            "label": "English captions",
            "required": True,
            "reason": "Add the required caption component.",
        },
    )
    assert first.status_code == second.status_code == 201
    first_id = first.json()["item"]["id"]
    second_id = second.json()["item"]["id"]
    collision = production_lab.client.patch(
        f"/v1/episodes/{episode_id}/delivery-items/{second_id}",
        json={"position": 1, "reason": "Try a duplicate checklist position."},
    )
    changed = production_lab.client.patch(
        f"/v1/episodes/{episode_id}/delivery-items/{first_id}",
        json={"label": "Episode metadata v2", "external_reference": "META-001", "reason": "Versioned metadata."},
    )
    removed = production_lab.client.request(
        "DELETE",
        f"/v1/episodes/{episode_id}/delivery-items/{second_id}",
        json={"reason": "Captions are supplied under a separate profile."},
    )

    assert collision.status_code == 409
    assert changed.status_code == removed.status_code == 200
    assert (
        production_lab.fetchval("SELECT label FROM episode_delivery_items WHERE id = $1", first_id)
        == "Episode metadata v2"
    )
    assert production_lab.fetchval("SELECT count(*) FROM episode_delivery_items WHERE id = $1", second_id) == 0
    events = production_lab.fetchval(
        "SELECT count(*) FROM activity_log WHERE organization_id = $1 AND entity_id = $2",
        production_lab.data.organization_id,
        first_id,
    )
    assert events >= 2


def test_delivery_recipients_and_external_manifest_shares_are_explicit_and_tenant_scoped(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    profile_id = _create_profile(production_lab)
    item = production_lab.client.post(
        f"/v1/delivery-profiles/{profile_id}/items", json=_profile_item_payload(production_lab)
    )
    assert item.status_code == 201, item.text
    episode_id = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]
    assert (
        production_lab.client.post(
            f"/v1/episodes/{episode_id}/delivery-manifest/apply",
            json={"delivery_profile_id": profile_id, "reason": "Share the client delivery status."},
        ).status_code
        == 200
    )
    delivery_item_id = production_lab.fetchval(
        "SELECT id::text FROM episode_delivery_items WHERE episode_id = $1 ORDER BY position LIMIT 1", episode_id
    )
    assert delivery_item_id
    recipients = production_lab.client.get(f"/v1/episodes/{episode_id}/delivery-recipients")
    assert recipients.status_code == 200
    recipient_ids = {contact["id"] for contact in recipients.json()["contacts"]}
    assert production_lab.data.technical_contact_id in recipient_ids
    assert production_lab.data.network_contact_id in recipient_ids
    assert production_lab.data.vendor_contact_id not in recipient_ids

    production_lab.execute(
        """
        UPDATE episode_delivery_items
        SET external_url = $1, external_reference = $2, is_externally_shared = false
        WHERE id = $3
        """,
        "https://internal.postpilot.test/transfer",
        "INTERNAL-TRANSFER-01",
        delivery_item_id,
    )
    shared = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-manifest/shared",
        json={"person_id": production_lab.data.client_person_id},
    )
    foreign_target = production_lab.client.post(
        f"/v1/episodes/{episode_id}/delivery-manifest/shared",
        json={"person_id": production_lab.data.foreign_person_id},
    )
    assert shared.status_code == 201
    assert foreign_target.status_code == 404

    production_lab.sign_out()
    production_lab.sign_in_as_client()
    manifest = production_lab.client.get(f"/v1/episodes/{episode_id}/delivery-manifest/shared")
    recipient_denied = production_lab.client.get(f"/v1/episodes/{episode_id}/delivery-recipients")
    assert manifest.status_code == 200
    assert manifest.json()["items"][0]["external_url"] is None
    assert manifest.json()["items"][0]["external_reference"] is None
    assert recipient_denied.status_code == 403

    production_lab.sign_out()
    production_lab.sign_in_as_manager()
    unshared = production_lab.client.request(
        "DELETE",
        f"/v1/episodes/{episode_id}/delivery-manifest/shared",
        json={"person_id": production_lab.data.client_person_id},
    )
    production_lab.sign_out()
    production_lab.sign_in_as_client()
    no_longer_shared = production_lab.client.get(f"/v1/episodes/{episode_id}/delivery-manifest/shared")

    assert unshared.status_code == 200
    assert no_longer_shared.status_code == 404
