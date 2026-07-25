from datetime import UTC, date, datetime

from app.delivery_lifecycle import (
    delivery_manifest_readiness,
    delivery_workflow_gate_state,
    validate_delivery_item_transition,
)


def transition(current: str, next_: str, **overrides: bool) -> str | None:
    options = {
        "qc_required": True,
        "has_external_evidence": True,
        "has_reason": True,
        "can_waive": True,
        "can_record_rejection": True,
        **overrides,
    }
    return validate_delivery_item_transition(
        current_status=current,
        next_status=next_,
        **options,
    )  # type: ignore[arg-type]


def test_qc_required_delivery_lifecycle() -> None:
    for current, next_ in [
        ("not_started", "preparing"),
        ("preparing", "ready_for_qc"),
        ("ready_for_qc", "qc_passed"),
        ("qc_passed", "dispatched"),
        ("dispatched", "receipt_confirmed"),
    ]:
        assert transition(current, next_) is None


def test_delivery_cannot_skip_lifecycle_or_evidence() -> None:
    assert "cannot move" in (transition("not_started", "dispatched") or "")
    assert "passing QC" in (transition("ready_for_qc", "dispatched") or "")
    assert "reference or link" in (transition("qc_passed", "dispatched", has_external_evidence=False) or "")
    assert "already" in (transition("dispatched", "dispatched") or "")


def test_non_qc_component_can_dispatch_after_ready_for_qc_with_evidence() -> None:
    assert transition("ready_for_qc", "dispatched", qc_required=False) is None
    assert "reference or link" in (
        transition("ready_for_qc", "dispatched", qc_required=False, has_external_evidence=False) or ""
    )


def test_rejection_and_waiver_are_reasoned_authorised_exceptions() -> None:
    assert "not authorised" in (transition("dispatched", "rejected", can_record_rejection=False) or "")
    assert "rejection reason" in (transition("dispatched", "rejected", has_reason=False) or "")
    assert transition("dispatched", "rejected") is None
    assert "not authorised" in (transition("preparing", "waived", can_waive=False) or "")
    assert "waiver reason" in (transition("preparing", "waived", has_reason=False) or "")
    assert transition("preparing", "waived") is None
    assert "cannot be waived" in (transition("receipt_confirmed", "waived") or "")


def test_manifest_readiness_counts_required_items_and_risk() -> None:
    result = delivery_manifest_readiness(
        [
            {"required": True, "status": "receipt_confirmed", "due_date": "2026-07-16"},
            {"required": True, "status": "dispatched", "due_date": "2026-07-18"},
            {"required": True, "status": "not_started", "due_date": "2026-07-15"},
            {"required": False, "status": "not_started", "due_date": "2026-07-01"},
        ],
        datetime(2026, 7, 17, 12, tzinfo=UTC),
    )
    assert result["required_item_count"] == 3
    assert result["completed_required_item_count"] == 1
    assert result["progress_percent"] == 33
    assert result["facility_dispatched"] is False
    assert result["client_network_accepted"] is False
    assert result["deadline_risk"] == "overdue"


def test_manifest_readiness_distinguishes_approaching_required_deadlines_from_overdue_ones() -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=UTC)
    at_risk = delivery_manifest_readiness([{"required": True, "status": "preparing", "due_date": "2026-07-19"}], now)
    on_track = delivery_manifest_readiness([{"required": True, "status": "preparing", "due_date": "2026-07-22"}], now)
    assert at_risk["deadline_risk"] == "at_risk"
    assert at_risk["at_risk_required_item_count"] == 1
    assert on_track["deadline_risk"] == "on_track"


def test_date_only_due_dates_remain_open_until_the_end_of_the_operational_day() -> None:
    same_day = delivery_manifest_readiness(
        [{"required": True, "status": "preparing", "due_date": "2026-07-17"}],
        datetime(2026, 7, 17, 12, tzinfo=UTC),
    )
    assert same_day["deadline_risk"] == "at_risk" and same_day["overdue_required_item_count"] == 0


def test_postgresql_date_due_dates_remain_compatible_with_readiness_calculation() -> None:
    result = delivery_manifest_readiness(
        [{"required": True, "status": "preparing", "due_date": date(2026, 7, 19)}],
        datetime(2026, 7, 20, 9, tzinfo=UTC),
    )

    assert result["deadline_risk"] == "overdue"


def test_dispatched_required_items_are_not_client_accepted_until_receipt_is_confirmed() -> None:
    dispatched = delivery_manifest_readiness(
        [
            {"required": True, "status": "dispatched", "due_date": "2026-07-20"},
            {"required": True, "status": "waived", "due_date": None},
        ],
        datetime(2026, 7, 17, 12, tzinfo=UTC),
    )
    assert (
        dispatched["facility_dispatched"] is True
        and dispatched["client_network_accepted"] is False
        and dispatched["progress_percent"] == 50
    )

    accepted = delivery_manifest_readiness(
        [
            {"required": True, "status": "receipt_confirmed", "due_date": "2026-07-20"},
            {"required": True, "status": "waived", "due_date": None},
        ],
        datetime(2026, 7, 17, 12, tzinfo=UTC),
    )
    assert accepted["client_network_accepted"] is True
    assert accepted["progress_percent"] == 100


def test_manifest_readiness_reports_required_external_recipient_gaps() -> None:
    gaps = delivery_manifest_readiness(
        [
            {
                "required": True,
                "status": "preparing",
                "due_date": None,
                "requires_external_recipient": True,
                "recipient_contact_id": None,
            },
            {
                "required": True,
                "status": "waived",
                "due_date": None,
                "requires_external_recipient": True,
                "recipient_contact_id": None,
            },
        ]
    )
    assert gaps["missing_required_recipient_count"] == 1 and gaps["has_delivery_contact_gaps"] is True


def test_waived_requirements_do_not_continue_to_report_a_missing_recipient() -> None:
    waived = delivery_manifest_readiness(
        [
            {
                "required": True,
                "status": "waived",
                "due_date": None,
                "requires_external_recipient": True,
                "recipient_contact_id": None,
            }
        ]
    )
    assert waived["has_delivery_contact_gaps"] is False
    assert waived["missing_required_recipient_count"] == 0


def test_delivery_gate_requires_passing_required_qc_and_facility_dispatch() -> None:
    assert "passing QC" in str(
        delivery_workflow_gate_state(
            [{"required": True, "status": "ready_for_qc", "qc_required": True, "qc_result": "not_started"}],
            "facility_dispatch",
        )["message"]
    )
    assert "not dispatched" in str(
        delivery_workflow_gate_state(
            [{"required": True, "status": "qc_passed", "qc_required": True, "qc_result": "passed"}], "facility_dispatch"
        )["message"]
    )
    ready_items = [
        {"required": True, "status": "dispatched", "qc_required": True, "qc_result": "passed"},
        {"required": False, "status": "qc_failed", "qc_required": True, "qc_result": "failed"},
    ]
    assert delivery_workflow_gate_state(ready_items, "facility_dispatch")["ready"] is True


def test_a_configured_delivery_stage_cannot_pass_against_an_empty_checklist() -> None:
    facility = delivery_workflow_gate_state([], "facility_dispatch")
    acceptance = delivery_workflow_gate_state([], "client_acceptance")
    assert facility["ready"] is False
    assert "no required items" in str(facility["message"])
    assert acceptance["ready"] is False


def test_client_acceptance_requires_receipt_or_an_authorised_exception() -> None:
    dispatched = [{"required": True, "status": "dispatched", "qc_required": True, "qc_result": "passed"}]
    missing_receipt = delivery_workflow_gate_state(dispatched, "client_acceptance")
    assert missing_receipt["ready"] is False
    assert "receipt confirmation" in str(missing_receipt["message"])
    assert delivery_workflow_gate_state(dispatched, "client_acceptance", True)["ready"] is True

    failed = [{"required": True, "status": "qc_failed", "qc_required": True, "qc_result": "failed"}]
    rejected = delivery_workflow_gate_state(failed, "client_acceptance", True)
    assert rejected["ready"] is False
    assert "failed QC" in str(rejected["message"])
