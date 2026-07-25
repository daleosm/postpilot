"""Pure delivery-manifest lifecycle rules shared by future FastAPI routes."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Literal, TypedDict

DeliveryStatus = Literal[
    "not_started",
    "preparing",
    "ready_for_qc",
    "qc_failed",
    "qc_passed",
    "dispatched",
    "receipt_confirmed",
    "rejected",
    "waived",
]
DeliveryGate = Literal["none", "facility_dispatch", "client_acceptance"]

_TRANSITIONS: dict[DeliveryStatus, set[DeliveryStatus]] = {
    "not_started": {"preparing"},
    "preparing": {"ready_for_qc"},
    "ready_for_qc": {"qc_failed", "qc_passed", "dispatched"},
    "qc_failed": {"preparing"},
    "qc_passed": {"dispatched"},
    "dispatched": {"receipt_confirmed", "rejected"},
    "receipt_confirmed": set(),
    "rejected": {"preparing"},
    "waived": set(),
}


class ReadinessItem(TypedDict, total=False):
    required: bool
    status: DeliveryStatus
    due_date: str | date | datetime | None
    requires_external_recipient: bool
    recipient_contact_id: str | None


def validate_delivery_item_transition(
    *,
    current_status: DeliveryStatus,
    next_status: DeliveryStatus,
    qc_required: bool,
    has_external_evidence: bool,
    has_reason: bool,
    can_waive: bool,
    can_record_rejection: bool,
) -> str | None:
    if current_status == next_status:
        return "This delivery item is already at that lifecycle state."
    if next_status == "waived":
        if current_status == "receipt_confirmed":
            return "An accepted delivery item cannot be waived."
        if not can_waive:
            return "Your role is not authorised to waive a delivery requirement."
        return None if has_reason else "A waiver reason is required."
    if next_status == "rejected":
        if not can_record_rejection:
            return "Your role is not authorised to record a delivery rejection."
        if not has_reason:
            return "A rejection reason is required."
    if next_status not in _TRANSITIONS[current_status]:
        return (
            f"A delivery item cannot move from {current_status.replace('_', ' ')} to {next_status.replace('_', ' ')}."
        )
    if current_status == "ready_for_qc" and next_status == "dispatched" and qc_required:
        return "This item requires a passing QC result before it can be dispatched."
    if next_status == "dispatched" and not has_external_evidence:
        return "Add an external delivery reference or link before marking this item dispatched."
    return None


def _due(value: str | date | datetime) -> datetime | None:
    try:
        if isinstance(value, str) and len(value) == 10:
            return datetime.fromisoformat(f"{value}T23:59:59.999+00:00")
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, time.max, tzinfo=UTC)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def delivery_manifest_readiness(items: list[ReadinessItem], now: datetime | None = None) -> dict[str, int | bool | str]:
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    required = [item for item in items if item["required"]]
    complete = [item for item in required if item["status"] in {"receipt_confirmed", "waived"}]
    outstanding = [item for item in required if item not in complete]
    dates = [_due(item["due_date"]) for item in outstanding if item.get("due_date")]
    valid_dates = [value for value in dates if value]
    overdue = sum(value < now for value in valid_dates)
    at_risk = sum(now <= value <= now + timedelta(days=3) for value in valid_dates)
    missing_recipients = sum(
        item.get("requires_external_recipient", False) and not item.get("recipient_contact_id") for item in outstanding
    )
    return {
        "required_item_count": len(required),
        "completed_required_item_count": len(complete),
        "outstanding_required_item_count": len(outstanding),
        "progress_percent": round((len(complete) / len(required)) * 100) if required else 100,
        "facility_dispatched": all(
            item["status"] in {"dispatched", "receipt_confirmed", "waived"} for item in required
        ),
        "client_network_accepted": all(item["status"] in {"receipt_confirmed", "waived"} for item in required),
        "deadline_risk": "overdue" if overdue else "at_risk" if at_risk else "on_track",
        "overdue_required_item_count": overdue,
        "at_risk_required_item_count": at_risk,
        "required_items_without_due_date": sum(not item.get("due_date") for item in outstanding),
        "missing_required_recipient_count": missing_recipients,
        "has_delivery_contact_gaps": missing_recipients > 0,
    }


def delivery_workflow_gate_state(
    items: list[dict[str, object]], gate: DeliveryGate, has_local_acceptance_exception: bool = False
) -> dict[str, bool | str | None]:
    if gate == "none":
        return {"ready": True, "facility_ready": True, "client_receipt_complete": True, "message": None}
    required = [item for item in items if item["required"]]
    if not required:
        return {
            "ready": False,
            "facility_ready": False,
            "client_receipt_complete": False,
            "message": (
                "This delivery manifest has no required items. Add or apply the confirmed "
                "delivery requirements before signing off this stage."
            ),
        }
    failed = [item for item in required if item["status"] in {"qc_failed", "rejected"}]
    if failed:
        return {
            "ready": False,
            "facility_ready": False,
            "client_receipt_complete": False,
            "message": (
                f"{len(failed)} required delivery item"
                f"{' has' if len(failed) == 1 else 's have'} failed QC or been rejected. "
                "Resolve the correction before sign-off."
            ),
        }
    qc = [item for item in required if item["qc_required"] and item["qc_result"] not in {"passed", "waived"}]
    dispatched = [item for item in required if item["status"] not in {"dispatched", "receipt_confirmed", "waived"}]
    if qc or dispatched:
        message = (
            f"{len(qc)} required delivery item"
            f"{' still needs' if len(qc) == 1 else 's still need'} passing QC before delivery sign-off."
            if qc
            else f"{len(dispatched)} required delivery item{' is' if len(dispatched) == 1 else 's are'} not dispatched."
        )
        return {"ready": False, "facility_ready": False, "client_receipt_complete": False, "message": message}
    if gate == "facility_dispatch":
        return {"ready": True, "facility_ready": True, "client_receipt_complete": False, "message": None}
    receipts = [item for item in required if item["status"] not in {"receipt_confirmed", "waived"}]
    if not receipts or has_local_acceptance_exception:
        return {"ready": True, "facility_ready": True, "client_receipt_complete": not receipts, "message": None}
    return {
        "ready": False,
        "facility_ready": True,
        "client_receipt_complete": False,
        "message": (
            f"{len(receipts)} required delivery item"
            f"{' still needs' if len(receipts) == 1 else 's still need'} recipient receipt confirmation, "
            "or an authorised local acceptance exception."
        ),
    }
