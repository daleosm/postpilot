"""The one-current-stage workflow projection used by API read models."""

from __future__ import annotations

from typing import Literal, TypedDict

WorkflowStatus = Literal["not_started", "in_progress", "awaiting_sign_off", "blocked", "complete"]


class WorkflowStage(TypedDict):
    id: str
    name: str
    position: int


def resolve_current_episode_workflow_state(
    *, workflow_stage_id: str | None, workflow_status: WorkflowStatus, stages: list[WorkflowStage]
) -> dict[str, str | None]:
    current = next(
        (stage for stage in sorted(stages, key=lambda stage: stage["position"]) if stage["id"] == workflow_stage_id),
        None,
    )
    name = current["name"] if current else None
    label = (
        f"Awaiting sign-off · {name or 'workflow'}"
        if workflow_status == "awaiting_sign_off"
        else f"Blocked · {name or 'workflow'}"
        if workflow_status == "blocked"
        else "Complete"
        if workflow_status == "complete"
        else name or "Not started"
    )
    return {
        "display_status": workflow_status,
        "label": label,
        "primary_stage_id": current["id"] if current else None,
        "primary_stage_name": name,
    }
