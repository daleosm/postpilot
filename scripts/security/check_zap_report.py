"""Apply PostPilot's versioned ZAP alert policy to JSON reports.

The packaged ZAP wrappers retain ``-I`` while the project tunes its baseline:
they always emit a complete report, and this explicit policy is the real CI
gate. It can promote Medium findings from report-only to blocking after review
without changing the scan command. Accepted findings must be narrow,
documented, reviewed, and time-limited.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

RISK_CODES = {
    "0": "Informational",
    "1": "Low",
    "2": "Medium",
    "3": "High",
    "4": "Critical",
}


@dataclass(frozen=True)
class Alert:
    report: Path
    plugin_id: str
    name: str
    risk: str
    urls: tuple[str, ...]


def _risk(alert: dict[str, Any]) -> str:
    code = str(alert.get("riskcode", ""))
    if code in RISK_CODES:
        return RISK_CODES[code]
    return str(alert.get("riskdesc", "Informational")).split(maxsplit=1)[0]


def _alerts(report: Path) -> list[Alert]:
    payload = json.loads(report.read_text(encoding="utf-8"))
    alerts: list[Alert] = []
    for site in payload.get("site", []):
        for raw_alert in site.get("alerts", []):
            instances = raw_alert.get("instances", [])
            urls = tuple(str(instance.get("uri", "")) for instance in instances) or (
                "",
            )
            alerts.append(
                Alert(
                    report=report,
                    plugin_id=str(raw_alert.get("pluginid", "unknown")),
                    name=str(raw_alert.get("alert", "Unnamed ZAP alert")),
                    risk=_risk(raw_alert),
                    urls=urls,
                )
            )
    return alerts


def _accepted_exception(
    alert: Alert, accepted: list[dict[str, str]]
) -> dict[str, str] | None:
    today = datetime.now(UTC).date()
    for exception in accepted:
        required = {"pluginId", "urlPattern", "reason", "reviewOn", "expiresOn"}
        if not required.issubset(exception):
            missing = ", ".join(sorted(required - set(exception)))
            raise ValueError(
                f"Accepted ZAP alert is missing required field(s): {missing}"
            )
        try:
            expiry = date.fromisoformat(exception["expiresOn"])
            review_date = date.fromisoformat(exception["reviewOn"])
        except ValueError as error:
            raise ValueError(
                f"Invalid accepted-alert review/expiry date: {exception}"
            ) from error
        if review_date > expiry:
            raise ValueError(
                f"Accepted ZAP alert review date must not be after expiry: {exception}"
            )
        if expiry < today or exception["pluginId"] != alert.plugin_id:
            continue
        if any(re.fullmatch(exception["urlPattern"], url) for url in alert.urls):
            return exception
    return None


def _risk_actions(policy: dict[str, Any]) -> dict[str, str]:
    actions = policy.get("riskActions")
    if not isinstance(actions, dict):
        raise TypeError("ZAP policy requires a riskActions object.")
    required_risks = set(RISK_CODES.values())
    missing = required_risks - set(actions)
    if missing:
        raise ValueError(
            f"ZAP policy is missing actions for: {', '.join(sorted(missing))}"
        )
    invalid = {
        risk: action
        for risk, action in actions.items()
        if action not in {"fail", "report", "ignore"}
    }
    if invalid:
        raise ValueError(f"ZAP policy has invalid risk action(s): {invalid}")
    return {str(risk): str(action) for risk, action in actions.items()}


def _validate_medium_review(policy: dict[str, Any], actions: dict[str, str]) -> None:
    review = policy.get("mediumReview")
    if not isinstance(review, dict):
        raise TypeError("ZAP policy requires a mediumReview object.")
    if review.get("mode") not in {"report", "fail"}:
        raise ValueError("ZAP mediumReview.mode must be report or fail.")
    if review.get("mode") != actions["Medium"]:
        raise ValueError("ZAP mediumReview.mode must match riskActions.Medium.")
    if not isinstance(review.get("promotion"), str) or not review["promotion"].strip():
        raise ValueError("ZAP mediumReview requires a promotion note.")
    try:
        date.fromisoformat(str(review["reviewOn"]))
    except (KeyError, ValueError) as error:
        raise ValueError("ZAP mediumReview requires an ISO reviewOn date.") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("reports", nargs="+", type=Path)
    args = parser.parse_args()

    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    if policy.get("version") != 1:
        raise ValueError(
            "Unsupported or missing ZAP policy version; expected version 1."
        )
    actions = _risk_actions(policy)
    _validate_medium_review(policy, actions)
    accepted = list(policy.get("acceptedAlerts", []))

    failures: list[Alert] = []
    reported: list[Alert] = []
    accepted_alerts: list[tuple[Alert, dict[str, str]]] = []
    for report in args.reports:
        if not report.is_file():
            raise FileNotFoundError(f"ZAP report was not created: {report}")
        for alert in _alerts(report):
            exception = _accepted_exception(alert, accepted)
            if exception:
                accepted_alerts.append((alert, exception))
                continue
            action = actions.get(alert.risk, "report")
            if action == "fail":
                failures.append(alert)
            elif action == "report":
                reported.append(alert)

    for alert, exception in accepted_alerts:
        print(
            f"ZAP accepted: {alert.name} (rule {alert.plugin_id}) through {exception['expiresOn']} "
            f"(review {exception['reviewOn']}): {exception['reason']}"
        )
    for alert in reported:
        print(
            f"ZAP {alert.risk.lower()}: {alert.name} (rule {alert.plugin_id}) in {alert.report.name}: {', '.join(alert.urls)}"
        )
    for alert in failures:
        print(
            f"ZAP blocking {alert.risk}: {alert.name} (rule {alert.plugin_id}) in {alert.report.name}: {', '.join(alert.urls)}"
        )

    if failures:
        print(
            f"ZAP policy failed: {len(failures)} alert(s) configured as blocking.",
            file=sys.stderr,
        )
        return 1
    print(f"ZAP policy passed: {len(reported)} alert(s) reported; no blocking alerts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
