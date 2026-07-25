"""Concise delivery-register status and next-action helpers."""

from __future__ import annotations

from typing import TypedDict


class DeliveryItem(TypedDict):
    label: str
    required: bool
    status: str


class DeliveryReadiness(TypedDict):
    client_network_accepted: bool
    facility_dispatched: bool
    deadline_risk: str
    has_delivery_contact_gaps: bool


def delivery_register_state(manifest: dict[str, object] | None) -> str:
    if not manifest:
        return "not_configured"
    readiness = manifest["readiness"]
    assert isinstance(readiness, dict)
    items = manifest["items"]
    assert isinstance(items, list)
    if readiness["client_network_accepted"]:
        return "accepted"
    if (
        readiness["deadline_risk"] != "on_track"
        or readiness["has_delivery_contact_gaps"]
        or any(item["status"] in {"qc_failed", "rejected"} for item in items)
    ):
        return "needs_attention"
    return "dispatched" if readiness["facility_dispatched"] else "in_progress"


def next_delivery_action(manifest: dict[str, object] | None) -> str:
    if not manifest:
        return "Apply a delivery profile"
    readiness = manifest["readiness"]
    items = manifest["items"]
    assert isinstance(readiness, dict) and isinstance(items, list)
    if readiness["has_delivery_contact_gaps"]:
        return "Choose a delivery recipient"
    blocked = next((item for item in items if item["required"] and item["status"] in {"qc_failed", "rejected"}), None)
    if blocked:
        return f"Resolve {blocked['label']}"
    waiting = next((item for item in items if item["required"] and item["status"] == "dispatched"), None)
    if waiting:
        return f"Confirm receipt for {waiting['label']}"
    outstanding = next(
        (item for item in items if item["required"] and item["status"] not in {"receipt_confirmed", "waived"}), None
    )
    return f"Prepare {outstanding['label']}" if outstanding else "Delivery complete"
