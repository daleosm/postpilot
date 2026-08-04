from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts" / "security" / "check_zap_report.py"


def _report(path: Path, risk_code: str) -> None:
    path.write_text(
        json.dumps(
            {
                "site": [
                    {
                        "alerts": [
                            {
                                "pluginid": "10001",
                                "alert": "Example alert",
                                "riskcode": risk_code,
                                "instances": [{"uri": "http://example.test/v1/example"}],
                            }
                        ]
                    }
                ]
            }
        ),
        encoding="utf-8",
    )


def _policy(path: Path, accepted_alerts: list[dict[str, str]] | None = None) -> None:
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "riskActions": {
                    "Critical": "fail",
                    "High": "fail",
                    "Medium": "report",
                    "Low": "report",
                    "Informational": "report",
                },
                "mediumReview": {
                    "mode": "report",
                    "reviewOn": "2098-01-01",
                    "promotion": "Promote Medium after the synthetic baseline review.",
                },
                "acceptedAlerts": accepted_alerts or [],
            }
        ),
        encoding="utf-8",
    )


def _run(policy: Path, report: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECKER), "--policy", str(policy), str(report)],
        check=False,
        capture_output=True,
        text=True,
    )


def test_zap_policy_reports_medium_low_and_informational_without_failing(tmp_path: Path) -> None:
    policy, report = tmp_path / "policy.json", tmp_path / "report.json"
    _policy(policy)
    for risk_code, expected in (("2", "medium"), ("1", "low"), ("0", "informational")):
        _report(report, risk_code)
        result = _run(policy, report)

        assert result.returncode == 0
        assert f"ZAP {expected}" in result.stdout


def test_zap_policy_blocks_unaccepted_high_and_critical_alerts(tmp_path: Path) -> None:
    policy, report = tmp_path / "policy.json", tmp_path / "report.json"
    _policy(policy)
    for risk_code, expected in (("3", "High"), ("4", "Critical")):
        _report(report, risk_code)
        result = _run(policy, report)

        assert result.returncode == 1
        assert f"ZAP blocking {expected}" in result.stdout


def test_zap_policy_allows_only_documented_unexpired_exception(tmp_path: Path) -> None:
    policy, report = tmp_path / "policy.json", tmp_path / "report.json"
    _policy(
        policy,
        [
            {
                "pluginId": "10001",
                "urlPattern": r"http://example\.test/v1/example",
                "reason": "Documented scanner false positive in this synthetic test.",
                "reviewOn": "2098-01-01",
                "expiresOn": "2099-01-01",
            }
        ],
    )
    _report(report, "3")

    result = _run(policy, report)

    assert result.returncode == 0
    assert "ZAP accepted" in result.stdout
    assert "ZAP policy passed" in result.stdout


def test_zap_policy_rejects_false_positive_without_a_review_date(tmp_path: Path) -> None:
    policy, report = tmp_path / "policy.json", tmp_path / "report.json"
    _policy(
        policy,
        [
            {
                "pluginId": "10001",
                "urlPattern": r"http://example\.test/v1/example",
                "reason": "This must not be accepted without a review date.",
                "expiresOn": "2099-01-01",
            }
        ],
    )
    _report(report, "3")

    result = _run(policy, report)

    assert result.returncode != 0
    assert "reviewOn" in result.stderr or "reviewOn" in result.stdout
