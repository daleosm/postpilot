"""Isolated FastAPI equivalents for the show and episode API contracts.

The fixtures deliberately create two post houses. Every assertion therefore
tests the real PostgreSQL tenant boundary rather than relying on a browser-side
filter or a shared demo record.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from uuid import uuid4

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.security import hash_node_scrypt_password

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Production API integration tests run in CI against migrated PostgreSQL.",
)


@dataclass(frozen=True)
class ProductionLab:
    organization_id: str
    foreign_organization_id: str
    manager_user_id: str
    manager_email: str
    viewer_user_id: str
    viewer_email: str
    client_user_id: str
    client_email: str
    manager_person_id: str
    editor_person_id: str
    colorist_person_id: str
    client_person_id: str
    foreign_person_id: str
    room_id: str
    foreign_room_id: str
    client_company_id: str
    production_company_id: str
    foreign_company_id: str
    technical_contact_id: str
    network_contact_id: str
    vendor_contact_id: str
    foreign_contact_id: str
    show_id: str
    foreign_show_id: str
    season_id: str
    empty_season_id: str
    foreign_season_id: str
    foreign_episode_id: str
    foreign_qc_report_id: str
    foreign_qc_issue_id: str
    workflow_stage_id: str
    delivery_profile_id: str
    foreign_delivery_profile_id: str


@dataclass
class ProductionApiLab:
    client: TestClient
    data: ProductionLab
    database_url: str

    def sign_in(self, email: str) -> dict[str, object]:
        response = self.client.post("/v1/auth/sign-in", json={"email": email, "password": "password"})
        assert response.status_code == 200, response.text
        return response.json()

    def sign_in_as_manager(self) -> dict[str, object]:
        return self.sign_in(self.data.manager_email)

    def sign_in_as_viewer(self) -> dict[str, object]:
        return self.sign_in(self.data.viewer_email)

    def sign_in_as_client(self) -> dict[str, object]:
        return self.sign_in(self.data.client_email)

    def sign_out(self) -> None:
        response = self.client.post("/v1/auth/sign-out")
        assert response.status_code == 204, response.text

    def fetchrow(self, query: str, *values: object) -> asyncpg.Record | None:
        return asyncio.run(_fetchrow(self.database_url, query, *values))

    def fetchval(self, query: str, *values: object) -> object:
        return asyncio.run(_fetchval(self.database_url, query, *values))

    def execute(self, query: str, *values: object) -> None:
        asyncio.run(_execute(self.database_url, query, *values))


def _database_url() -> str:
    return (
        os.getenv("POSTPILOT_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or "postgresql://postpilot:postpilot@localhost:5432/postpilot"
    )


async def _fetchrow(database_url: str, query: str, *values: object) -> asyncpg.Record | None:
    connection = await asyncpg.connect(database_url)
    try:
        return await connection.fetchrow(query, *values)
    finally:
        await connection.close()


async def _fetchval(database_url: str, query: str, *values: object) -> object:
    connection = await asyncpg.connect(database_url)
    try:
        return await connection.fetchval(query, *values)
    finally:
        await connection.close()


async def _execute(database_url: str, query: str, *values: object) -> None:
    connection = await asyncpg.connect(database_url)
    try:
        await connection.execute(query, *values)
    finally:
        await connection.close()


def _new_lab() -> ProductionLab:
    token = uuid4().hex[:12]
    return ProductionLab(
        organization_id=str(uuid4()),
        foreign_organization_id=str(uuid4()),
        manager_user_id=f"python-show-manager-{token}",
        manager_email=f"python-show-manager-{token}@postpilot.test",
        viewer_user_id=f"python-show-viewer-{token}",
        viewer_email=f"python-show-viewer-{token}@postpilot.test",
        client_user_id=f"python-client-{token}",
        client_email=f"python-client-{token}@postpilot.test",
        manager_person_id=str(uuid4()),
        editor_person_id=str(uuid4()),
        colorist_person_id=str(uuid4()),
        client_person_id=str(uuid4()),
        foreign_person_id=str(uuid4()),
        room_id=str(uuid4()),
        foreign_room_id=str(uuid4()),
        client_company_id=str(uuid4()),
        production_company_id=str(uuid4()),
        foreign_company_id=str(uuid4()),
        technical_contact_id=str(uuid4()),
        network_contact_id=str(uuid4()),
        vendor_contact_id=str(uuid4()),
        foreign_contact_id=str(uuid4()),
        show_id=str(uuid4()),
        foreign_show_id=str(uuid4()),
        season_id=str(uuid4()),
        empty_season_id=str(uuid4()),
        foreign_season_id=str(uuid4()),
        foreign_episode_id=str(uuid4()),
        foreign_qc_report_id=str(uuid4()),
        foreign_qc_issue_id=str(uuid4()),
        workflow_stage_id=str(uuid4()),
        delivery_profile_id=str(uuid4()),
        foreign_delivery_profile_id=str(uuid4()),
    )


async def _seed_lab(database_url: str, lab: ProductionLab) -> None:
    connection = await asyncpg.connect(database_url)
    try:
        password_hash = hash_node_scrypt_password("password")
        workflow_id, foreign_workflow_id = str(uuid4()), str(uuid4())
        foreign_workflow_stage_id = str(uuid4())
        await connection.execute(
            """
            INSERT INTO users (id, name, email, password_hash)
            VALUES
              ($1, 'Python Production Manager', $2, $3),
              ($4, 'Python Production Viewer', $5, $3),
              ($6, 'Python Client', $7, $3)
            """,
            lab.manager_user_id,
            lab.manager_email,
            password_hash,
            lab.viewer_user_id,
            lab.viewer_email,
            lab.client_user_id,
            lab.client_email,
        )
        await connection.execute(
            """
            INSERT INTO organizations (id, name, slug, currency)
            VALUES ($1, 'Python Production Lab', $2, 'GBP'), ($3, 'Python Foreign Lab', $4, 'GBP')
            """,
            lab.organization_id,
            f"python-production-{lab.organization_id[:8]}",
            lab.foreign_organization_id,
            f"python-foreign-{lab.foreign_organization_id[:8]}",
        )
        await connection.execute(
            """
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES ($1, $2, 'member'), ($1, $3, 'member'), ($1, $4, 'client')
            """,
            lab.organization_id,
            lab.manager_user_id,
            lab.viewer_user_id,
            lab.client_user_id,
        )
        await connection.execute(
            """
            INSERT INTO organization_role_policies (id, organization_id, role, label, permissions)
            VALUES
              ($1, $2, 'production_manager', 'Production manager', $3::jsonb),
              ($4, $2, 'production_viewer', 'Production viewer', $5::jsonb)
            """,
            str(uuid4()),
            lab.organization_id,
            json.dumps(["manage_settings", "manage_production", "do_assigned_work", "sign_off_work", "view_all_operations", "manage_qc_delivery", "manage_commercial"]),
            str(uuid4()),
            json.dumps(["do_assigned_work"]),
        )
        await connection.execute(
            """
            INSERT INTO people (id, organization_id, user_id, name, email, role)
            VALUES
              ($1, $2, $3, 'Python Production Manager', $4, 'production_manager'),
              ($5, $2, NULL, 'Python Editor', 'python-editor@postpilot.test', 'editor'),
              ($6, $2, NULL, 'Python Colourist', 'python-colourist@postpilot.test', 'colourist'),
              ($7, $2, $8, 'Python Client', $9, 'client'),
              ($10, $2, $11, 'Python Production Viewer', $12, 'production_viewer'),
              ($13, $14, NULL, 'Foreign Editor', 'foreign-editor@postpilot.test', 'editor')
            """,
            lab.manager_person_id,
            lab.organization_id,
            lab.manager_user_id,
            lab.manager_email,
            lab.editor_person_id,
            lab.colorist_person_id,
            lab.client_person_id,
            lab.client_user_id,
            lab.client_email,
            str(uuid4()),
            lab.viewer_user_id,
            lab.viewer_email,
            lab.foreign_person_id,
            lab.foreign_organization_id,
        )
        await connection.execute(
            """
            INSERT INTO rooms (id, organization_id, name, type)
            VALUES
              ($1, $2, 'Python Edit Bay', 'edit_bay'),
              ($3, $4, 'Foreign Edit Bay', 'edit_bay')
            """,
            lab.room_id,
            lab.organization_id,
            lab.foreign_room_id,
            lab.foreign_organization_id,
        )
        await connection.execute(
            """
            INSERT INTO crm_companies (id, organization_id, name, type)
            VALUES
              ($1, $2, 'Python Network', 'network'),
              ($3, $2, 'Python Productions', 'production_company'),
              ($4, $5, 'Foreign Network', 'network')
            """,
            lab.client_company_id,
            lab.organization_id,
            lab.production_company_id,
            lab.foreign_company_id,
            lab.foreign_organization_id,
        )
        await connection.execute(
            """
            INSERT INTO post_workflows (id, organization_id, name, is_default)
            VALUES ($1, $2, 'Python default workflow', true), ($3, $4, 'Foreign workflow', true)
            """,
            workflow_id,
            lab.organization_id,
            foreign_workflow_id,
            lab.foreign_organization_id,
        )
        await connection.execute(
            """
            INSERT INTO workflow_stages (
              id, organization_id, workflow_id, name, key,
              position, color, is_terminal, can_start_early
            )
            VALUES
              ($1, $2, $3, 'Editorial preparation', 'editorial_preparation', 1, '#506f68', true, false),
              ($4, $5, $6, 'Foreign preparation', 'foreign_preparation', 1, '#506f68', false, false)
            """,
            lab.workflow_stage_id,
            lab.organization_id,
            workflow_id,
            foreign_workflow_stage_id,
            lab.foreign_organization_id,
            foreign_workflow_id,
        )
        await connection.execute(
            """
            INSERT INTO shows (
              id, organization_id, title, code, network,
              client_company_id, production_company_id, time_zone
            )
            VALUES
              ($1, $2, 'Python Series', 'PYS', 'Python Network', $3, $4, 'Europe/London'),
              ($5, $6, 'Foreign Series', 'FRN', 'Foreign Network', $7, NULL, 'Europe/London')
            """,
            lab.show_id,
            lab.organization_id,
            lab.client_company_id,
            lab.production_company_id,
            lab.foreign_show_id,
            lab.foreign_organization_id,
            lab.foreign_company_id,
        )
        await connection.execute(
            """
            INSERT INTO crm_contacts (id, organization_id, company_id, name, email, contact_type)
            VALUES
              ($1, $2, $3, 'Python Technical Delivery', 'technical@python.test', 'technical_delivery'),
              ($4, $2, $3, 'Python Network Delivery', 'network@python.test', 'technical_delivery'),
              ($5, $2, $6, 'Python Vendor Contact', 'vendor@python.test', 'technical_delivery'),
              ($7, $8, $9, 'Foreign Technical Delivery', 'foreign-technical@python.test', 'technical_delivery')
            """,
            lab.technical_contact_id,
            lab.organization_id,
            lab.client_company_id,
            lab.network_contact_id,
            lab.vendor_contact_id,
            lab.production_company_id,
            lab.foreign_contact_id,
            lab.foreign_organization_id,
            lab.foreign_company_id,
        )
        await connection.execute(
            """
            INSERT INTO show_contacts (id, organization_id, show_id, contact_id, responsibility, relationship)
            VALUES ($1, $2, $3, $4, 'delivery_qc', 'Technical delivery recipient')
            """,
            str(uuid4()),
            lab.organization_id,
            lab.show_id,
            lab.technical_contact_id,
        )
        await connection.execute(
            """
            INSERT INTO delivery_profiles (
              id, organization_id, client_company_id, network, show_id, name, is_active
            )
            VALUES
              ($1, $2, $3, 'Python Network', $4, 'Python delivery profile', true),
              ($5, $6, $7, 'Foreign Network', $8, 'Foreign delivery profile', true)
            """,
            lab.delivery_profile_id,
            lab.organization_id,
            lab.client_company_id,
            lab.show_id,
            lab.foreign_delivery_profile_id,
            lab.foreign_organization_id,
            lab.foreign_company_id,
            lab.foreign_show_id,
        )
        await connection.execute(
            """
            INSERT INTO seasons (id, organization_id, show_id, number, title)
            VALUES
              ($1, $2, $3, 1, 'Python Series · Season 1'),
              ($4, $2, $3, 2, 'Python Series · Season 2'),
              ($5, $6, $7, 1, 'Foreign Series · Season 1')
            """,
            lab.season_id,
            lab.organization_id,
            lab.show_id,
            lab.empty_season_id,
            lab.foreign_season_id,
            lab.foreign_organization_id,
            lab.foreign_show_id,
        )
        prior_episode_id = str(uuid4())
        await connection.execute(
            """
            INSERT INTO episodes (
              id, organization_id, season_id, workflow_stage_id, editor_id,
              number, production_code, title, status, workflow_status, qc_status
            )
            VALUES (
              $1, $2, $3, $4, $5, 1, 'PYS101', 'Prior Python episode',
              'development', 'not_started', 'not_started'
            )
            """,
            prior_episode_id,
            lab.organization_id,
            lab.season_id,
            lab.workflow_stage_id,
            lab.editor_person_id,
        )
        await connection.execute(
            """
            INSERT INTO episodes (
              id, organization_id, season_id, number, title, status, workflow_status, qc_status
            )
            VALUES ($1, $2, $3, 1, 'Foreign Python episode', 'development', 'not_started', 'not_started')
            """,
            lab.foreign_episode_id,
            lab.foreign_organization_id,
            lab.foreign_season_id,
        )
        await connection.execute(
            """
            INSERT INTO qc_reports (id, organization_id, episode_id, status, summary, completed_at)
            VALUES ($1, $2, $3, 'failed', 'Foreign QC report', now())
            """,
            lab.foreign_qc_report_id,
            lab.foreign_organization_id,
            lab.foreign_episode_id,
        )
        await connection.execute(
            """
            INSERT INTO qc_issues (id, organization_id, qc_report_id, severity, description, status)
            VALUES ($1, $2, $3, 'major', 'Foreign QC issue', 'open')
            """,
            lab.foreign_qc_issue_id,
            lab.foreign_organization_id,
            lab.foreign_qc_report_id,
        )
        await connection.execute(
            """
            INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
            VALUES ($1, $2, $3, $4, false), ($5, $2, $3, $6, false)
            """,
            str(uuid4()),
            lab.organization_id,
            prior_episode_id,
            lab.editor_person_id,
            str(uuid4()),
            lab.colorist_person_id,
        )
    finally:
        await connection.close()


async def _clean_lab(database_url: str, lab: ProductionLab) -> None:
    connection = await asyncpg.connect(database_url)
    try:
        await connection.execute(
            "DELETE FROM organizations WHERE id = ANY($1::uuid[])", [lab.organization_id, lab.foreign_organization_id]
        )
        await connection.execute(
            "DELETE FROM users WHERE id = ANY($1::text[])",
            [lab.manager_user_id, lab.viewer_user_id, lab.client_user_id],
        )
    finally:
        await connection.close()


@pytest.fixture
def production_lab(monkeypatch: pytest.MonkeyPatch) -> ProductionApiLab:
    database_url = _database_url()
    lab = _new_lab()
    asyncio.run(_seed_lab(database_url, lab))
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", database_url)
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "postpilot-ci-auth-secret-which-is-long-enough")
    monkeypatch.setenv("POSTPILOT_DEBUG_DEMO", "true")
    get_settings.cache_clear()
    from app.main import create_app

    with TestClient(create_app()) as client:
        yield ProductionApiLab(client=client, data=lab, database_url=database_url)

    asyncio.run(_clean_lab(database_url, lab))
    get_settings.cache_clear()


def test_creates_a_show_inside_the_active_tenant(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()

    response = production_lab.client.post(
        "/v1/shows",
        json={
            "title": "Signal Line",
            "code": "sl",
            "client_company_id": production_lab.data.client_company_id,
            "production_company_id": production_lab.data.production_company_id,
            "description": "Initial post plan.",
        },
    )

    assert response.status_code == 201, response.text
    saved = production_lab.fetchrow(
        """
        SELECT organization_id::text, title, code,
               client_company_id::text, production_company_id::text, description
        FROM shows WHERE id = $1
        """,
        response.json()["id"],
    )
    assert saved
    assert dict(saved) == {
        "organization_id": production_lab.data.organization_id,
        "title": "Signal Line",
        "code": "SL",
        "client_company_id": production_lab.data.client_company_id,
        "production_company_id": production_lab.data.production_company_id,
        "description": "Initial post plan.",
    }


def test_rejects_invalid_show_payload_before_writing(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    initial_count = production_lab.fetchval(
        "SELECT count(*) FROM shows WHERE organization_id = $1", production_lab.data.organization_id
    )

    response = production_lab.client.post("/v1/shows", json={"title": "", "code": "x"})

    assert response.status_code == 422
    assert (
        production_lab.fetchval(
            "SELECT count(*) FROM shows WHERE organization_id = $1", production_lab.data.organization_id
        )
        == initial_count
    )


def test_member_without_production_capability_cannot_create_or_edit_a_show(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_viewer()

    create = production_lab.client.post("/v1/shows", json={"title": "Unauthorised", "code": "NO"})
    update = production_lab.client.patch(f"/v1/shows/{production_lab.data.show_id}", json={"title": "Unauthorised"})

    assert create.status_code == 403
    assert update.status_code == 403


def test_client_episode_workspace_is_redacted_and_foreign_routes_remain_hidden(
    production_lab: ProductionApiLab,
) -> None:
    """A client signer gets workflow context, never the internal post floor."""
    production_lab.sign_in_as_manager()
    episode_id = next(
        item["id"]
        for item in production_lab.client.get("/v1/episodes").json()["episodes"]
        if item["title"] == "Prior Python episode"
    )
    # Client membership is intentionally not enough to inspect an episode.
    # Share this one explicitly so the test exercises the redacted workspace
    # projection rather than an unauthorised-route response.
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        episode_id,
        production_lab.data.client_person_id,
    )

    production_lab.sign_in_as_client()
    workspace = production_lab.client.get(f"/v1/episodes/{episode_id}/workspace")
    assert workspace.status_code == 200, workspace.text
    payload = workspace.json()
    assert payload["episode"]["editor_name"] is None
    assert payload["episode"]["producer_name"] is None
    assert payload["schedule"] == []
    assert payload["budget"] == []
    assert payload["activity"] == []
    assert payload["episode_team"] == []
    assert payload["work_orders"] == []
    assert payload["qc_history"] == []
    assert payload["vendor_options"] == []
    assert payload["delivery_manifest"] is None

    direct = production_lab.client.get(f"/v1/episodes/{episode_id}")
    assert direct.status_code == 200
    assert direct.json()["team"] == []
    assert direct.json()["episode"]["editor_name"] is None
    foreign_workspace = production_lab.client.get(f"/v1/episodes/{production_lab.data.foreign_episode_id}/workspace")
    assert foreign_workspace.status_code == 404


def test_approval_inbox_uses_the_compressed_sign_off_capability(
    production_lab: ProductionApiLab,
) -> None:
    """A named client signer must see their pending gate in the approval inbox.

    This guards the capability compression boundary: actor permissions contain
    ``sign_off_work``, while the old Node-era endpoint key was
    ``sign_off_workflow_stages``.
    """
    episode = production_lab.fetchrow(
        "SELECT id::text FROM episodes WHERE organization_id = $1 ORDER BY created_at LIMIT 1",
        production_lab.data.organization_id,
    )
    assert episode
    approval_rule_id = str(uuid4())
    approval_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.client_person_id,
    )
    production_lab.execute(
        """
        INSERT INTO workflow_stage_approval_rules (
          id, organization_id, workflow_stage_id, label, approval_order, is_required
        ) VALUES ($1, $2, $3, 'Client delivery sign-off', 1, true)
        """,
        approval_rule_id,
        production_lab.data.organization_id,
        production_lab.data.workflow_stage_id,
    )
    production_lab.execute(
        """
        UPDATE episodes SET workflow_status = 'awaiting_sign_off'
        WHERE id = $1 AND organization_id = $2
        """,
        episode["id"],
        production_lab.data.organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO episode_workflow_approvals (
          id, organization_id, episode_id, workflow_stage_id, approval_rule_id,
          required_person_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', now(), now())
        """,
        approval_id,
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.workflow_stage_id,
        approval_rule_id,
        production_lab.data.client_person_id,
    )

    production_lab.sign_in_as_client()
    response = production_lab.client.get("/v1/approvals")

    assert response.status_code == 200, response.text
    sign_offs = response.json()["sign_offs"]
    assert len(sign_offs) == 1
    sign_off = dict(sign_offs[0])
    passed_at = sign_off.pop("passed_at")
    assert isinstance(passed_at, str)
    assert sign_off == {
        "id": f"{episode['id']}:{approval_rule_id}",
        "approval_rule_id": approval_rule_id,
        "episode_id": episode["id"],
        "show_id": production_lab.data.show_id,
        "workflow_stage_id": production_lab.data.workflow_stage_id,
        "stage_name": "Editorial preparation",
        "stage_position": 1,
        "sign_off_label": "Client delivery sign-off",
        "approver_role": None,
        "approval_order": 1,
        "is_required": True,
        "show_title": "Python Series",
        "episode_title": "Prior Python episode",
        "episode_number": 1,
    }


def test_show_creation_and_edit_reject_foreign_crm_companies(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    create = production_lab.client.post(
        "/v1/shows",
        json={
            "title": "Cross-tenant account",
            "code": "XTA",
            "client_company_id": production_lab.data.foreign_company_id,
        },
    )
    update = production_lab.client.patch(
        f"/v1/shows/{production_lab.data.show_id}",
        json={"production_company_id": production_lab.data.foreign_company_id},
    )

    assert create.status_code == update.status_code == 404
    assert (
        production_lab.fetchval(
            "SELECT production_company_id::text FROM shows WHERE id = $1", production_lab.data.show_id
        )
        == production_lab.data.production_company_id
    )


def test_creates_an_episode_with_the_selected_tenant_team(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()

    response = production_lab.client.post(
        "/v1/episodes",
        json={
            "season_id": production_lab.data.season_id,
            "number": 2,
            "production_code": "PYS102",
            "title": "New Python episode",
            "assigned_producer_id": production_lab.data.manager_person_id,
            "editor_id": production_lab.data.editor_person_id,
            "colorist_id": production_lab.data.colorist_person_id,
            "air_date": "2035-03-11",
            "locked_cut_date": "2035-03-04",
            "delivery_deadline": "2035-03-20T17:00:00Z",
            "team_ids": [production_lab.data.editor_person_id, production_lab.data.colorist_person_id],
        },
    )

    assert response.status_code == 201, response.text
    episode_id = response.json()["id"]
    episode = production_lab.fetchrow(
        """
        SELECT organization_id::text, workflow_stage_id::text, workflow_status,
               status, editor_id::text, colorist_id::text
        FROM episodes WHERE id = $1
        """,
        episode_id,
    )
    assert episode
    assert dict(episode) == {
        "organization_id": production_lab.data.organization_id,
        "workflow_stage_id": production_lab.data.workflow_stage_id,
        "workflow_status": "not_started",
        "status": "development",
        "editor_id": production_lab.data.editor_person_id,
        "colorist_id": production_lab.data.colorist_person_id,
    }
    team_count = production_lab.fetchval(
        "SELECT count(*) FROM episode_team_assignments WHERE episode_id = $1", episode_id
    )
    assert team_count == 2


def test_episode_team_signer_is_role_matched_and_used_for_workflow_submission(
    production_lab: ProductionApiLab,
) -> None:
    """Only the checked team member with the configured tenant role is assigned a gate."""
    production_lab.sign_in_as_manager()
    episode = production_lab.fetchrow(
        "SELECT id::text FROM episodes WHERE organization_id = $1 AND title = 'Prior Python episode'",
        production_lab.data.organization_id,
    )
    assert episode
    second_editor_id = str(uuid4())
    second_assignment_id = str(uuid4())
    approval_rule_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO people (id, organization_id, name, role)
        VALUES ($1, $2, 'Python Second Editor', 'editor')
        """,
        second_editor_id,
        production_lab.data.organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        second_assignment_id,
        production_lab.data.organization_id,
        episode["id"],
        second_editor_id,
    )
    # The manager submits the work in this exercise, so make their otherwise
    # unrelated production role an ordinary episode-team assignment too.
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.manager_person_id,
    )
    production_lab.execute(
        """
        INSERT INTO workflow_stage_approval_rules (
          id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required
        ) VALUES ($1, $2, $3, 'editor', 'Editor sign-off', 1, true)
        """,
        approval_rule_id,
        production_lab.data.organization_id,
        production_lab.data.workflow_stage_id,
    )
    first_assignment = production_lab.fetchrow(
        """
        SELECT id::text FROM episode_team_assignments
        WHERE organization_id = $1 AND episode_id = $2 AND person_id = $3
        """,
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.editor_person_id,
    )
    assert first_assignment

    team = production_lab.client.get(f"/v1/episodes/{episode['id']}/team")
    assert team.status_code == 200, team.text
    assert "editor" in team.json()["eligible_signer_roles"]
    assert production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team",
        json={"assignment_id": first_assignment["id"], "is_signer": True},
    ).status_code == 200
    # This mirrors an approval created by the short-lived arbitrary-slot
    # implementation: it has a rule but no recorded role snapshot yet.
    production_lab.execute(
        """
        INSERT INTO episode_workflow_approvals (
          id, organization_id, episode_id, workflow_stage_id, approval_rule_id,
          required_person_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', now(), now())
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.workflow_stage_id,
        approval_rule_id,
        production_lab.data.editor_person_id,
    )
    # Selecting another editor transfers the single role-level signer tick.
    assert production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team",
        json={"assignment_id": second_assignment_id, "is_signer": True},
    ).status_code == 200
    signer_flags = production_lab.fetchrow(
        """
        SELECT
          bool_or(person_id = $1 AND is_lead) AS first_editor_is_signer,
          bool_or(person_id = $2 AND is_lead) AS second_editor_is_signer
        FROM episode_team_assignments
        WHERE organization_id = $3 AND episode_id = $4
        """,
        production_lab.data.editor_person_id,
        second_editor_id,
        production_lab.data.organization_id,
        episode["id"],
    )
    assert signer_flags and not signer_flags["first_editor_is_signer"] and signer_flags["second_editor_is_signer"]

    # A person may still be on the team, but cannot be nominated if their role
    # is not configured on any workflow sign-off rule.
    colourist_assignment = production_lab.fetchrow(
        """
        SELECT id::text FROM episode_team_assignments
        WHERE organization_id = $1 AND episode_id = $2 AND person_id = $3
        """,
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.colorist_person_id,
    )
    assert colourist_assignment
    wrong_role = production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team",
        json={"assignment_id": colourist_assignment["id"], "is_signer": True},
    )
    assert wrong_role.status_code == 409

    assert production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "start"},
    ).status_code == 200
    submit = production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "submit"},
    )
    assert submit.status_code == 200, submit.text
    approval = production_lab.fetchrow(
        """
        SELECT required_person_id::text, approver_role
        FROM episode_workflow_approvals
        WHERE organization_id = $1 AND episode_id = $2 AND approval_rule_id = $3
        """,
        production_lab.data.organization_id,
        episode["id"],
        approval_rule_id,
    )
    assert approval and dict(approval) == {"required_person_id": second_editor_id, "approver_role": "editor"}


def test_signer_lifecycle_requires_the_checked_matching_people_and_advances_the_stage(
    production_lab: ProductionApiLab,
) -> None:
    """Required gates use checked people, not generic role membership or capabilities."""
    production_lab.sign_in_as_manager()
    episode = production_lab.fetchrow(
        "SELECT id::text FROM episodes WHERE organization_id = $1 AND title = 'Prior Python episode'",
        production_lab.data.organization_id,
    )
    assert episode
    supervisor_user_id, supervisor_person_id = str(uuid4()), str(uuid4())
    alternate_user_id, alternate_person_id = str(uuid4()), str(uuid4())
    token = uuid4().hex[:10]
    supervisor_email = f"workflow-supervisor-{token}@postpilot.test"
    alternate_email = f"workflow-alternate-{token}@postpilot.test"
    password_hash = hash_node_scrypt_password("password")
    production_lab.execute(
        """
        INSERT INTO organization_role_policies (id, organization_id, role, label, permissions)
        VALUES ($1, $2, 'production_supervisor', 'Production supervisor', '["do_assigned_work", "sign_off_work"]'::jsonb)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
    )
    production_lab.execute(
        """
        INSERT INTO users (id, name, email, password_hash)
        VALUES ($1, 'Python Supervisor', $2, $3), ($4, 'Python Alternate', $5, $3)
        """,
        supervisor_user_id,
        supervisor_email,
        password_hash,
        alternate_user_id,
        alternate_email,
    )
    production_lab.execute(
        """
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, 'member'), ($1, $3, 'member')
        """,
        production_lab.data.organization_id,
        supervisor_user_id,
        alternate_user_id,
    )
    production_lab.execute(
        """
        INSERT INTO people (id, organization_id, user_id, name, email, role)
        VALUES
          ($1, $2, $3, 'Python Supervisor', $4, 'production_supervisor'),
          ($5, $2, $6, 'Python Alternate', $7, 'production_manager')
        """,
        supervisor_person_id,
        production_lab.data.organization_id,
        supervisor_user_id,
        supervisor_email,
        alternate_person_id,
        alternate_user_id,
        alternate_email,
    )
    manager_assignment, supervisor_assignment, alternate_assignment = str(uuid4()), str(uuid4()), str(uuid4())
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES
          ($1, $2, $3, $4, false), ($5, $2, $3, $6, false), ($7, $2, $3, $8, false)
        """,
        manager_assignment,
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.manager_person_id,
        supervisor_assignment,
        supervisor_person_id,
        alternate_assignment,
        alternate_person_id,
    )
    manager_rule, supervisor_rule = str(uuid4()), str(uuid4())
    production_lab.execute(
        """
        INSERT INTO workflow_stage_approval_rules (
          id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required
        ) VALUES
          ($1, $2, $3, 'production_manager', 'Production manager sign-off', 1, true),
          ($4, $2, $3, 'production_supervisor', 'Production supervisor sign-off', 2, true)
        """,
        manager_rule,
        production_lab.data.organization_id,
        production_lab.data.workflow_stage_id,
        supervisor_rule,
    )

    # One checked role is insufficient: the second required role blocks submit.
    assert production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team", json={"assignment_id": manager_assignment, "is_signer": True}
    ).status_code == 200
    assert production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "start"},
    ).status_code == 200
    missing = production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "submit"},
    )
    assert missing.status_code == 409 and "production supervisor" in missing.json()["detail"]
    assert production_lab.fetchval("SELECT workflow_status FROM episodes WHERE id = $1", episode["id"]) == "in_progress"

    assert production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team", json={"assignment_id": supervisor_assignment, "is_signer": True}
    ).status_code == 200
    assert production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "submit"},
    ).status_code == 200

    # Removing a signer removes their live approval assignment. Selecting an
    # alternate of the same role transfers only that role's pending gate.
    assert production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team", json={"assignment_id": manager_assignment, "is_signer": False}
    ).status_code == 200
    assert production_lab.fetchval(
        "SELECT required_person_id::text FROM episode_workflow_approvals WHERE episode_id = $1 AND approval_rule_id = $2",
        episode["id"],
        manager_rule,
    ) is None
    assert production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team", json={"assignment_id": alternate_assignment, "is_signer": True}
    ).status_code == 200

    production_lab.sign_in(alternate_email)
    alternate_inbox = production_lab.client.get("/v1/approvals")
    assert alternate_inbox.status_code == 200
    assert {item["approval_rule_id"] for item in alternate_inbox.json()["sign_offs"]} == {manager_rule}

    # An equally capable but unchecked manager cannot sign the alternate's gate.
    production_lab.sign_in_as_manager()
    wrong_signer = production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={
            "workflow_stage_id": production_lab.data.workflow_stage_id,
            "approval_rule_id": manager_rule,
            "action": "sign_off",
        },
    )
    assert wrong_signer.status_code == 403

    production_lab.sign_in(alternate_email)
    assert production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={
            "workflow_stage_id": production_lab.data.workflow_stage_id,
            "approval_rule_id": manager_rule,
            "action": "sign_off",
        },
    ).status_code == 200
    production_lab.sign_in(supervisor_email)
    completed = production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={
            "workflow_stage_id": production_lab.data.workflow_stage_id,
            "approval_rule_id": supervisor_rule,
            "action": "sign_off",
        },
    )
    assert completed.status_code == 200
    assert production_lab.fetchval("SELECT workflow_status FROM episodes WHERE id = $1", episode["id"]) == "complete"

    # Signer controls reject an assignment from another episode and users
    # without production-management capability.
    production_lab.sign_in_as_manager()
    other_episode = production_lab.client.post(
        "/v1/episodes", json={"season_id": production_lab.data.season_id, "number": 9, "title": "Other team episode"}
    ).json()["id"]
    cross_episode = production_lab.client.patch(
        f"/v1/episodes/{other_episode}/team", json={"assignment_id": alternate_assignment, "is_signer": True}
    )
    assert cross_episode.status_code == 404
    foreign_assignment = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        foreign_assignment,
        production_lab.data.foreign_organization_id,
        production_lab.data.foreign_episode_id,
        production_lab.data.foreign_person_id,
    )
    foreign_assignment_attempt = production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team", json={"assignment_id": foreign_assignment, "is_signer": True}
    )
    assert foreign_assignment_attempt.status_code == 404
    viewer_person = production_lab.fetchrow(
        "SELECT id::text FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.viewer_user_id,
    )
    assert viewer_person
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        episode["id"],
        viewer_person["id"],
    )
    production_lab.sign_in_as_viewer()
    forbidden = production_lab.client.patch(
        f"/v1/episodes/{episode['id']}/team", json={"assignment_id": alternate_assignment, "is_signer": True}
    )
    assert forbidden.status_code == 403


def test_optional_sign_off_does_not_block_workflow_submission(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode = production_lab.fetchrow(
        "SELECT id::text FROM episodes WHERE organization_id = $1 AND title = 'Prior Python episode'",
        production_lab.data.organization_id,
    )
    assert episode
    production_lab.execute(
        """
        INSERT INTO episode_team_assignments (id, organization_id, episode_id, person_id, is_lead)
        VALUES ($1, $2, $3, $4, false)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        episode["id"],
        production_lab.data.manager_person_id,
    )
    production_lab.execute(
        """
        INSERT INTO workflow_stage_approval_rules (
          id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required
        ) VALUES ($1, $2, $3, 'production_manager', 'Optional manager sign-off', 1, false)
        """,
        str(uuid4()),
        production_lab.data.organization_id,
        production_lab.data.workflow_stage_id,
    )
    assert production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "start"},
    ).status_code == 200
    submitted = production_lab.client.post(
        f"/v1/episodes/{episode['id']}",
        json={"workflow_stage_id": production_lab.data.workflow_stage_id, "action": "submit"},
    )
    assert submitted.status_code == 200, submitted.text
    assert production_lab.fetchval("SELECT workflow_status FROM episodes WHERE id = $1", episode["id"]) == "complete"


def test_workflow_settings_api_validates_roles_persists_the_order_and_protects_tenant_boundaries(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    bootstrap = production_lab.client.get("/v1/settings/bootstrap")
    assert bootstrap.status_code == 200, bootstrap.text
    workflow = bootstrap.json()["workflow"]
    assert workflow
    stage = workflow["stages"][0]
    rule_id, added_stage_id = str(uuid4()), str(uuid4())
    stages = [
        {**stage, "name": "Editorial intake", "position": 2},
        {
            "id": added_stage_id,
            "name": "QC decision",
            "key": "qc_decision",
            "position": 1,
            "color": "#4b7063",
            "is_terminal": False,
            "can_start_early": False,
            "requires_qc_pass": True,
            "delivery_gate": "none",
        },
    ]
    payload = {
        "stages": stages,
        "rules": [
            {
                "id": rule_id,
                "workflow_stage_id": stage["id"],
                "approver_role": "production_manager",
                "label": "Browser supplied label must be ignored",
                "approval_order": 1,
                "is_required": True,
            }
        ],
        "work_order_templates": [],
    }
    saved = production_lab.client.patch(f"/v1/workflows/{workflow['id']}", json=payload)
    assert saved.status_code == 200, saved.text
    rule = production_lab.fetchrow(
        "SELECT approver_role, label FROM workflow_stage_approval_rules WHERE id = $1", rule_id
    )
    assert rule and dict(rule) == {"approver_role": "production_manager", "label": "Production manager sign-off"}
    positions = production_lab.fetchrow(
        "SELECT min(position) AS first_position, max(position) AS last_position FROM workflow_stages WHERE workflow_id = $1",
        workflow["id"],
    )
    assert positions and dict(positions) == {"first_position": 1, "last_position": 2}

    for invalid_role in (None, "foreign_role"):
        invalid = production_lab.client.patch(
            f"/v1/workflows/{workflow['id']}",
            json={**payload, "rules": [{**payload["rules"][0], "approver_role": invalid_role}]},
        )
        assert invalid.status_code == 400
    invalid_stage_ref = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}",
        json={**payload, "rules": [{**payload["rules"][0], "workflow_stage_id": str(uuid4())}]},
    )
    assert invalid_stage_ref.status_code == 400
    invalid_template_ref = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}",
        json={**payload, "work_order_templates": [{"workflow_stage_id": str(uuid4()), "title": "Invalid"}]},
    )
    assert invalid_template_ref.status_code == 400
    invalid_delivery_gate = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}",
        json={**payload, "stages": [{**stages[0], "delivery_gate": "not_a_delivery_gate"}, stages[1]]},
    )
    assert invalid_delivery_gate.status_code == 400
    missing_terminal = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}",
        json={**payload, "stages": [{**item, "is_terminal": False} for item in stages]},
    )
    assert missing_terminal.status_code == 400
    multiple_terminals = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}",
        json={**payload, "stages": [{**item, "is_terminal": True} for item in stages]},
    )
    assert multiple_terminals.status_code == 400
    no_qc = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}", json={**payload, "stages": [{**item, "requires_qc_pass": False} for item in stages]}
    )
    assert no_qc.status_code == 409
    delete_referenced = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}", json={**payload, "stages": [stages[1]]}
    )
    # The submitted rule would point to a stage that is no longer present, so
    # this is rejected before any destructive stage update is attempted.
    assert delete_referenced.status_code == 400
    foreign_workflow = production_lab.client.patch(f"/v1/workflows/{uuid4()}", json=payload)
    assert foreign_workflow.status_code == 404

    client_rule = production_lab.client.patch(
        f"/v1/workflows/{workflow['id']}",
        json={**payload, "rules": [{**payload["rules"][0], "approver_role": "client"}]},
    )
    assert client_rule.status_code == 200
    assert production_lab.fetchval("SELECT label FROM workflow_stage_approval_rules WHERE id = $1", rule_id) == "Client sign-off"

    production_lab.sign_in_as_viewer()
    assert production_lab.client.patch(f"/v1/workflows/{workflow['id']}", json=payload).status_code == 403


def test_role_settings_cannot_remove_a_workflow_role_and_renaming_updates_its_label(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_manager()
    rule_id = str(uuid4())
    production_lab.execute(
        """
        INSERT INTO workflow_stage_approval_rules (
          id, organization_id, workflow_stage_id, approver_role, label, approval_order, is_required
        ) VALUES ($1, $2, $3, 'approval_only', 'Finishing approval sign-off', 1, true)
        """,
        rule_id,
        production_lab.data.organization_id,
        production_lab.data.workflow_stage_id,
    )
    base_policies = [
        {"role": "production_manager", "label": "Production manager", "permissions": ["manage_settings", "manage_production", "do_assigned_work", "sign_off_work", "view_all_operations", "manage_qc_delivery", "manage_commercial"]},
        {"role": "production_viewer", "label": "Production viewer", "permissions": ["do_assigned_work"]},
        {"role": "editor", "label": "Editor", "permissions": ["do_assigned_work", "sign_off_work"]},
        {"role": "colourist", "label": "Colourist", "permissions": ["do_assigned_work", "sign_off_work"]},
        {"role": "approval_only", "label": "Final creative approver", "permissions": ["sign_off_work"]},
        {"role": "client", "label": "Client", "permissions": ["sign_off_work"]},
    ]
    renamed = production_lab.client.patch("/v1/settings/role-policies", json={"policies": base_policies})
    assert renamed.status_code == 200, renamed.text
    assert production_lab.fetchval("SELECT label FROM workflow_stage_approval_rules WHERE id = $1", rule_id) == "Final creative approver sign-off"
    removal = production_lab.client.patch(
        "/v1/settings/role-policies", json={"policies": [item for item in base_policies if item["role"] != "approval_only"]}
    )
    assert removal.status_code == 409
    assert "workflow sign-offs" in removal.json()["detail"]


def test_episode_creation_rejects_duplicate_numbers_and_foreign_references(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    payload = {"season_id": production_lab.data.season_id, "number": 2, "title": "Episode two"}
    assert production_lab.client.post("/v1/episodes", json=payload).status_code == 201

    duplicate = production_lab.client.post("/v1/episodes", json=payload)
    foreign_season = production_lab.client.post(
        "/v1/episodes", json={**payload, "season_id": production_lab.data.foreign_season_id, "number": 3}
    )
    foreign_person = production_lab.client.post(
        "/v1/episodes", json={**payload, "number": 3, "editor_id": production_lab.data.foreign_person_id}
    )

    assert duplicate.status_code == 409
    assert foreign_season.status_code == foreign_person.status_code == 404


def test_episode_updates_are_tenant_scoped_and_validate_input(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    response = production_lab.client.post(
        "/v1/episodes",
        json={"season_id": production_lab.data.season_id, "number": 2, "title": "Original title"},
    )
    episode_id = response.json()["id"]

    update = production_lab.client.patch(
        f"/v1/episodes/{episode_id}",
        json={"title": "Renamed episode", "production_code": "PYS102A", "air_date": "2035-03-12"},
    )
    invalid = production_lab.client.patch(f"/v1/episodes/{episode_id}", json={"title": ""})
    foreign = production_lab.client.patch(f"/v1/episodes/{uuid4()}", json={"title": "No access"})

    assert update.status_code == 200
    assert invalid.status_code == 422
    assert foreign.status_code == 404
    saved = production_lab.fetchrow("SELECT title, production_code FROM episodes WHERE id = $1", episode_id)
    assert saved and dict(saved) == {"title": "Renamed episode", "production_code": "PYS102A"}


def test_episode_team_controls_are_idempotent_and_tenant_scoped(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = production_lab.client.post(
        "/v1/episodes",
        json={"season_id": production_lab.data.season_id, "number": 2, "title": "Team episode"},
    ).json()["id"]

    add = production_lab.client.post(
        f"/v1/episodes/{episode_id}/team", json={"person_id": production_lab.data.editor_person_id}
    )
    duplicate = production_lab.client.post(
        f"/v1/episodes/{episode_id}/team", json={"person_id": production_lab.data.editor_person_id}
    )
    foreign = production_lab.client.post(
        f"/v1/episodes/{episode_id}/team", json={"person_id": production_lab.data.foreign_person_id}
    )

    assert add.status_code == 201 and add.json()["duplicate"] is False
    assert duplicate.status_code == 201 and duplicate.json()["duplicate"] is True
    assert foreign.status_code == 404


def test_copy_last_episode_team_distinguishes_empty_and_foreign_seasons(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()

    previous = production_lab.client.get(f"/v1/episodes/seasons/{production_lab.data.season_id}/last-episode-team")
    empty = production_lab.client.get(f"/v1/episodes/seasons/{production_lab.data.empty_season_id}/last-episode-team")
    foreign = production_lab.client.get(
        f"/v1/episodes/seasons/{production_lab.data.foreign_season_id}/last-episode-team"
    )

    assert previous.status_code == 200
    assert {person["person_id"] for person in previous.json()["team"]} == {
        production_lab.data.editor_person_id,
        production_lab.data.colorist_person_id,
    }
    assert empty.status_code == 200 and empty.json() == {"team": []}
    assert foreign.status_code == 404


def test_booking_api_uses_buffer_aware_conflict_detection_and_pencil_holds(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    payload = {
        "title": "Editorial block",
        "room_id": production_lab.data.room_id,
        "person_id": production_lab.data.editor_person_id,
        "episode_id": production_lab.data.season_id,
        "starts_at": "2035-05-01T10:00:00Z",
        "ends_at": "2035-05-01T12:00:00Z",
        "setup_minutes": 15,
        "handover_minutes": 20,
        "status": "confirmed",
        "booking_type": "edit",
    }
    # Bookings must point to an episode, not a season; use the seeded prior
    # episode discovered via the tenant-scoped episode list.
    payload["episode_id"] = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]
    created = production_lab.client.post("/v1/bookings", json=payload)
    assert created.status_code == 201, created.text

    conflict_payload = {
        **payload,
        "title": "Overlapping block",
        "starts_at": "2035-05-01T12:10:00Z",
        "ends_at": "2035-05-01T13:00:00Z",
        "setup_minutes": 0,
        "handover_minutes": 0,
    }
    preview = production_lab.client.post("/v1/bookings/conflicts", json=conflict_payload)
    rejected = production_lab.client.post("/v1/bookings", json=conflict_payload)

    assert preview.status_code == 200
    assert preview.json()["conflicts"][0]["overlaps"] == ["room", "person"]
    assert preview.json()["nearest_slot"]
    assert rejected.status_code == 409

    first_hold = production_lab.client.post(
        "/v1/bookings",
        json={**payload, "title": "Pencil one", "is_option": True, "status": "tentative"},
    )
    second_hold = production_lab.client.post(
        "/v1/bookings",
        json={**payload, "title": "Pencil two", "is_option": True, "status": "tentative"},
    )
    assert first_hold.status_code == second_hold.status_code == 201
    options = sorted(
        (entry for entry in production_lab.client.get("/v1/bookings").json()["bookings"] if entry["is_option"]),
        key=lambda entry: entry["option_rank"],
    )
    assert [entry["option_rank"] for entry in options] == [1, 2]

    withdrawn = production_lab.client.patch(
        f"/v1/bookings/{options[0]['id']}",
        json={
            "title": options[0]["title"],
            "room_id": options[0]["room_id"],
            "episode_id": options[0]["episode_id"],
            "person_id": options[0]["person_id"],
            "guest_person_id": options[0]["guest_person_id"],
            "starts_at": options[0]["starts_at"],
            "ends_at": options[0]["ends_at"],
            "setup_minutes": options[0]["setup_minutes"],
            "handover_minutes": options[0]["handover_minutes"],
            "status": "cancelled",
            "booking_type": options[0]["booking_type"],
            "is_option": True,
            "notes": options[0]["notes"],
        },
    )
    assert withdrawn.status_code == 200, withdrawn.text
    remaining = [
        entry
        for entry in production_lab.client.get("/v1/bookings").json()["bookings"]
        if entry["is_option"] and entry["status"] != "cancelled"
    ]
    assert [entry["option_rank"] for entry in remaining] == [1]


def test_booking_api_rejects_foreign_tenant_resources(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    response = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Foreign room attempt",
            "room_id": production_lab.data.foreign_room_id,
            "starts_at": "2035-05-02T10:00:00Z",
            "ends_at": "2035-05-02T11:00:00Z",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Invalid room for this post house."


def test_booking_client_attendee_is_added_to_the_episode_team(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]

    response = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Client review",
            "room_id": production_lab.data.room_id,
            "episode_id": episode_id,
            "guest_person_id": production_lab.data.client_person_id,
            "starts_at": "2035-05-03T10:00:00Z",
            "ends_at": "2035-05-03T11:00:00Z",
            "booking_type": "client_review",
        },
    )

    assert response.status_code == 201, response.text
    team = production_lab.fetchval(
        """
        SELECT count(*) FROM episode_team_assignments
        WHERE organization_id = $1 AND episode_id = $2 AND person_id = $3
        """,
        production_lab.data.organization_id,
        episode_id,
        production_lab.data.client_person_id,
    )
    assert team == 1


def test_booking_conflict_preview_does_not_reveal_foreign_room_data(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    response = production_lab.client.post(
        "/v1/bookings/conflicts",
        json={
            "title": "Foreign room preview",
            "room_id": production_lab.data.foreign_room_id,
            "starts_at": "2035-05-02T10:00:00Z",
            "ends_at": "2035-05-02T11:00:00Z",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Invalid room for this post house."


def test_member_without_production_capability_cannot_create_or_preview_bookings(
    production_lab: ProductionApiLab,
) -> None:
    production_lab.sign_in_as_viewer()
    payload = {
        "title": "Viewer booking attempt",
        "room_id": production_lab.data.room_id,
        "starts_at": "2035-05-02T10:00:00Z",
        "ends_at": "2035-05-02T11:00:00Z",
    }

    assert production_lab.client.post("/v1/bookings", json=payload).status_code == 403
    assert production_lab.client.post("/v1/bookings/conflicts", json=payload).status_code == 403


def test_assigned_work_member_can_read_scoped_booking_resources(production_lab: ProductionApiLab) -> None:
    """Assigned artists can reserve work without receiving tenant-wide staff data."""
    viewer_person_id = production_lab.fetchval(
        "SELECT id FROM people WHERE organization_id = $1 AND user_id = $2",
        production_lab.data.organization_id,
        production_lab.data.viewer_user_id,
    )
    assert viewer_person_id
    production_lab.sign_in_as_viewer()

    resources = production_lab.client.get("/v1/bookings/resources")

    assert resources.status_code == 200, resources.text
    payload = resources.json()
    assert payload["rooms"]
    assert [person["id"] for person in payload["people"]] == [str(viewer_person_id)]
    assert payload["guest_accounts"] == []


def test_client_can_see_only_their_own_shared_review_booking(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = production_lab.client.get("/v1/episodes").json()["episodes"][0]["id"]
    review = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Client review",
            "room_id": production_lab.data.room_id,
            "episode_id": episode_id,
            "guest_person_id": production_lab.data.client_person_id,
            "starts_at": "2035-05-04T10:00:00Z",
            "ends_at": "2035-05-04T11:00:00Z",
            "booking_type": "client_review",
        },
    )
    internal = production_lab.client.post(
        "/v1/bookings",
        json={
            "title": "Internal finishing",
            "room_id": production_lab.data.room_id,
            "person_id": production_lab.data.editor_person_id,
            "episode_id": episode_id,
            "starts_at": "2035-05-04T12:00:00Z",
            "ends_at": "2035-05-04T13:00:00Z",
        },
    )
    assert review.status_code == internal.status_code == 201
    production_lab.sign_out()

    production_lab.sign_in_as_client()
    visible = production_lab.client.get("/v1/bookings")

    assert visible.status_code == 200
    assert [booking["id"] for booking in visible.json()["bookings"]] == [review.json()["id"]]
