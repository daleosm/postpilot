"""Tenant capability policy, intentionally independent of job-title names."""

from __future__ import annotations

from typing import Final

Permission = str

PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        "manage_settings",
        "manage_production",
        "do_assigned_work",
        "sign_off_work",
        "manage_qc_delivery",
        "manage_commercial",
        "manage_catering",
        "view_all_operations",
    }
)

LEGACY_PERMISSION_MAP: Final[dict[str, str]] = {
    "manage_shows": "manage_production",
    "manage_bookings": "manage_production",
    "manage_work_orders": "manage_production",
    "approve_work_orders": "manage_production",
    "manage_workflow_configuration": "manage_settings",
    "manage_workflow_stages": "manage_production",
    "authorize_early_starts": "manage_production",
    "manage_users": "manage_settings",
    "manage_rates": "manage_commercial",
    "manage_budget": "manage_commercial",
    "approve_budget_overruns": "manage_commercial",
    "approve_rate_overrides": "manage_commercial",
    "manage_qc": "manage_qc_delivery",
    "verify_qc": "manage_qc_delivery",
    "waive_qc": "manage_qc_delivery",
    "manage_delivery_profiles": "manage_qc_delivery",
    "manage_episode_manifests": "manage_qc_delivery",
    "update_delivery_items": "manage_qc_delivery",
    "confirm_delivery_receipt": "manage_qc_delivery",
    "authorize_delivery_exceptions": "manage_qc_delivery",
    "manage_catering": "manage_catering",
    "request_catering": "do_assigned_work",
    "update_assigned_work": "do_assigned_work",
    "update_assigned_workflow_work": "do_assigned_work",
    "submit_workflow_stages": "do_assigned_work",
    "sign_off_workflow_stages": "sign_off_work",
    "view_assigned": "do_assigned_work",
    "view_shared_delivery_status": "sign_off_work",
    "manage_workflow_tracks": "manage_production",
    "submit_workflow_tracks": "do_assigned_work",
    "sign_off_workflow_tracks": "sign_off_work",
    "authorize_workflow_exceptions": "manage_production",
}


def normalize_permission(value: str) -> Permission | None:
    candidate = LEGACY_PERMISSION_MAP.get(value, value)
    return candidate if candidate in PERMISSIONS else None


def policy_grants(permission: str, membership_role: str, policy_permissions: list[str] | None) -> bool:
    normalized = normalize_permission(permission)
    if normalized is None:
        return False
    if membership_role == "client":
        return normalized == "sign_off_work"
    return normalized in {item for item in (normalize_permission(value) for value in policy_permissions or []) if item}
