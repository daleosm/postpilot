"""Guardrails for the isolated authenticated active-DAST configuration."""

from __future__ import annotations

from pathlib import Path

from app.dast_seed import DAST_EMAIL_ENV, DAST_PASSWORD_ENV, DAST_USER_ID

ROOT = Path(__file__).resolve().parents[2]


def test_active_dast_user_is_an_explicit_low_privilege_fixture() -> None:
    source = (ROOT / "backend/app/dast_seed.py").read_text(encoding="utf-8")

    assert DAST_USER_ID == "user_dast_active_scan"
    assert DAST_EMAIL_ENV in source
    assert DAST_PASSWORD_ENV in source
    assert 'role="client"' in source
    assert "app.dast_seed" not in (ROOT / "backend/app/demo_seed.py").read_text(encoding="utf-8")


def test_active_dast_plan_uses_real_browser_login_and_a_strict_context() -> None:
    plan = (ROOT / ".github/zap/active-dast-plan.yaml").read_text(encoding="utf-8")

    for expected in (
        "method: browser",
        "loginPageUrl: http://127.0.0.1:5003/sign-in",
        "method: autodetect",
        "apiUrl: http://127.0.0.1:8000/openapi.json",
        "authenticated-session-check",
        "responseCode: 200",
        "type: activeScan",
        "__POSTPILOT_DAST_EMAIL__",
        "__POSTPILOT_DAST_PASSWORD__",
        "not an authorisation or tenant-boundary test suite",
        "prove permissions and tenancy",
    ):
        assert expected in plan

    for excluded in (
        "live|ready|healthz|metrics|openapi",
        "auth/(?:sign-out|change-password|microsoft)",
        "v1/debug",
        "billing|budget|purchase-orders|client-purchase-orders",
        "work-orders|deliveries|qc|catering|settings",
    ):
        assert excluded in plan


def test_active_dast_workflow_is_weekly_manual_and_disposable() -> None:
    workflow = (ROOT / ".github/workflows/security-active-dast.yml").read_text(encoding="utf-8")

    assert "workflow_dispatch:" in workflow
    assert 'cron: "37 2 * * 1"' in workflow
    assert "image: postgres:16-alpine" in workflow
    assert "python -m app.demo_seed" in workflow
    assert "python -m app.dast_seed" in workflow
    assert "openssl rand -hex 32" in workflow
    assert "POSTPILOT_DEBUG_DEMO" not in workflow
    assert "zap.sh -cmd -autorun" in workflow
    assert "check_zap_report.py" in workflow
    assert "alert-policy.json" in workflow
