"""FastAPI equivalents for the QC lifecycle server tests."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from test_production_api_integration import ProductionApiLab

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="QC FastAPI integration tests run in CI against migrated PostgreSQL.",
)


def _episode_id(lab: ProductionApiLab) -> str:
    response = lab.client.get("/v1/episodes")
    assert response.status_code == 200, response.text
    return response.json()["episodes"][0]["id"]


def _report(lab: ProductionApiLab, episode_id: str, status: str, **overrides: object):
    return lab.client.post(
        "/v1/qc-reports",
        json={"episode_id": episode_id, "status": status, "summary": f"QC {status} result.", **overrides},
    )


def test_qc_reports_and_issues_require_the_qc_delivery_capability(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    production_lab.sign_out()
    production_lab.sign_in_as_viewer()

    report = _report(production_lab, episode_id, "failed")
    issue = production_lab.client.post(
        "/v1/qc-issues",
        json={
            "qc_report_id": production_lab.data.foreign_qc_report_id,
            "severity": "major",
            "description": "No access.",
        },
    )

    assert report.status_code == issue.status_code == 403


def test_qc_keeps_one_active_run_then_rejects_duplicate_final_results(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    draft = _report(production_lab, episode_id, "draft")
    assert draft.status_code == 201, draft.text
    in_progress = _report(production_lab, episode_id, "in_progress", summary="Technical QC underway.")
    assert in_progress.status_code == 200, in_progress.text
    assert in_progress.json()["id"] == draft.json()["id"]

    # The current implementation treats a draft as an explicit submitted run.
    # Starting re-QC creates a new record only after a failed final decision;
    # draft → in-progress continues the same active run.
    started = _report(production_lab, episode_id, "draft", summary="Restart the active run.")
    assert started.status_code == 200
    assert started.json()["id"] == in_progress.json()["id"]
    passed = _report(production_lab, episode_id, "passed", summary="QC verified.")
    duplicate = _report(production_lab, episode_id, "passed", summary="Accidental repeat.")

    assert passed.status_code == 200
    assert duplicate.status_code == 409
    saved = production_lab.fetchrow("SELECT status, summary FROM qc_reports WHERE id = $1", passed.json()["id"])
    assert saved and dict(saved) == {"status": "passed", "summary": "QC verified."}
    assert production_lab.fetchval("SELECT qc_status FROM episodes WHERE id = $1", episode_id) == "passed"


def test_qc_payloads_and_issue_resolution_are_validated_and_audited(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    bad_url = _report(production_lab, episode_id, "failed", report_url="not-a-url")
    missing_waiver = _report(production_lab, episode_id, "waived", waiver_reason=None)
    failed = _report(production_lab, episode_id, "failed", checksum="abcdefgh", summary="A correction is required.")
    assert bad_url.status_code == missing_waiver.status_code == 422
    assert failed.status_code == 201, failed.text
    report_id = failed.json()["id"]

    invalid_issue = production_lab.client.post(
        "/v1/qc-issues",
        json={
            "qc_report_id": report_id,
            "severity": "major",
            "description": "Negative timecode",
            "timecode_seconds": -1,
        },
    )
    issue = production_lab.client.post(
        "/v1/qc-issues",
        json={"qc_report_id": report_id, "severity": "major", "description": "A valid issue."},
    )
    assert invalid_issue.status_code == 422
    assert issue.status_code == 201, issue.text
    issue_id = issue.json()["id"]
    missing_resolution = production_lab.client.patch(f"/v1/qc-issues/{issue_id}", json={"status": "resolved"})
    resolved = production_lab.client.patch(
        f"/v1/qc-issues/{issue_id}", json={"status": "resolved", "resolution": "Verified correction."}
    )

    assert missing_resolution.status_code == 422
    assert resolved.status_code == 200
    assert production_lab.fetchval("SELECT checksum FROM qc_reports WHERE id = $1", report_id) == "abcdefgh"
    work_order = production_lab.fetchval("SELECT status FROM post_work_orders WHERE qc_issue_id = $1", issue_id)
    assert work_order == "complete"
    assert (
        production_lab.fetchval(
            "SELECT action FROM activity_log WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1", issue_id
        )
        == "qc.issue_resolved"
    )


def test_failed_qc_requires_a_new_run_and_closed_corrections_before_a_pass(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    failed = _report(production_lab, episode_id, "failed", summary="A flash frame needs correction.")
    assert failed.status_code == 201, failed.text
    direct_pass = _report(production_lab, episode_id, "passed")
    re_qc = _report(production_lab, episode_id, "in_progress", summary="Re-QC started after correction.")
    blocked_pass = _report(production_lab, episode_id, "passed", summary="Still blocked.")

    assert direct_pass.status_code == 409
    assert re_qc.status_code == 201
    assert blocked_pass.status_code == 409
    production_lab.execute(
        """
        UPDATE post_work_orders SET status = 'complete'
        WHERE organization_id = $1 AND episode_id = $2 AND kind = 'qc_exception'
        """,
        production_lab.data.organization_id,
        episode_id,
    )
    passed = _report(production_lab, episode_id, "passed", summary="Re-QC verified after correction.")

    assert passed.status_code == 200
    assert production_lab.fetchval("SELECT qc_status FROM episodes WHERE id = $1", episode_id) == "passed"


def test_passed_re_qc_reconciles_stale_failed_delivery_items(production_lab: ProductionApiLab) -> None:
    """A passed re-QC must not leave the delivery manifest reporting failure."""
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    manifest_id, qc_item_id, metadata_item_id = str(uuid4()), str(uuid4()), str(uuid4())
    now = datetime.now(UTC)
    production_lab.execute(
        """
        INSERT INTO episode_delivery_manifests (
          id, organization_id, episode_id, profile_name, created_at, updated_at
        ) VALUES ($1, $2, $3, 'QC reconciliation fixture', $4, $4)
        """,
        manifest_id,
        production_lab.data.organization_id,
        episode_id,
        now,
    )
    production_lab.execute(
        """
        INSERT INTO episode_delivery_items (
          id, organization_id, episode_delivery_manifest_id, episode_id,
          component_type, label, required, requires_external_recipient,
          qc_required, status, qc_result, is_externally_shared, position, created_at, updated_at
        ) VALUES
          ($1, $2, $3, $4, 'master', 'Corrected picture master', true, false, true,
           'qc_failed', 'failed', false, 1, $5, $5),
          ($6, $2, $3, $4, 'metadata', 'Metadata sheet', true, false, false,
           'qc_failed', 'not_required', false, 2, $5, $5)
        """,
        qc_item_id,
        production_lab.data.organization_id,
        manifest_id,
        episode_id,
        now,
        metadata_item_id,
    )
    failed = _report(production_lab, episode_id, "failed", summary="Correct the delivery package.")
    assert failed.status_code == 201, failed.text
    assert _report(production_lab, episode_id, "in_progress", summary="Re-QC underway.").status_code == 201
    production_lab.execute(
        """
        UPDATE post_work_orders SET status = 'complete'
        WHERE organization_id = $1 AND episode_id = $2 AND kind = 'qc_exception'
        """,
        production_lab.data.organization_id,
        episode_id,
    )

    passed = _report(production_lab, episode_id, "passed", summary="Corrected package passed re-QC.")

    assert passed.status_code == 200, passed.text
    qc_item = production_lab.fetchrow(
        "SELECT status, qc_result FROM episode_delivery_items WHERE id = $1", qc_item_id
    )
    metadata_item = production_lab.fetchrow(
        "SELECT status, qc_result FROM episode_delivery_items WHERE id = $1", metadata_item_id
    )
    assert qc_item and dict(qc_item) == {"status": "qc_passed", "qc_result": "passed"}
    assert metadata_item and dict(metadata_item) == {"status": "preparing", "qc_result": "not_required"}


def test_qc_issue_waive_and_reopen_updates_its_linked_work_order(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    episode_id = _episode_id(production_lab)
    failed = _report(production_lab, episode_id, "failed", summary="A correction is required.")
    assert failed.status_code == 201
    issue = production_lab.client.post(
        "/v1/qc-issues",
        json={"qc_report_id": failed.json()["id"], "severity": "critical", "description": "Critical correction."},
    )
    assert issue.status_code == 201
    issue_id = issue.json()["id"]
    waived = production_lab.client.patch(
        f"/v1/qc-issues/{issue_id}", json={"status": "waived", "resolution": "Accepted by production."}
    )
    reopened = production_lab.client.patch(f"/v1/qc-issues/{issue_id}", json={"status": "open"})

    assert waived.status_code == reopened.status_code == 200
    assert production_lab.fetchval("SELECT status FROM post_work_orders WHERE qc_issue_id = $1", issue_id) == "open"


def test_qc_apis_do_not_allow_foreign_episode_report_or_issue_ids(production_lab: ProductionApiLab) -> None:
    production_lab.sign_in_as_manager()
    report = _report(production_lab, production_lab.data.foreign_episode_id, "failed")
    issue = production_lab.client.post(
        "/v1/qc-issues",
        json={
            "qc_report_id": production_lab.data.foreign_qc_report_id,
            "severity": "major",
            "description": "Attempt a cross-tenant issue.",
        },
    )
    update = production_lab.client.patch(
        f"/v1/qc-issues/{production_lab.data.foreign_qc_issue_id}",
        json={"status": "resolved", "resolution": "Attempt a cross-tenant update."},
    )

    assert report.status_code == issue.status_code == update.status_code == 404
