"""Current user's workflow sign-off and assigned-work inbox.

The route intentionally resolves named signers from tenant-owned approval rows;
it never infers authority from an occupational role label.
"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import and_, select

from app.api.dependencies import CurrentActor, DbSession
from app.db.tables import (
    episode_team_assignments,
    episode_workflow_approvals,
    episodes,
    post_work_orders,
    seasons,
    shows,
    workflow_stage_approval_rules,
    workflow_stages,
)

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("")
async def approval_inbox(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return only work and sign-offs that belong to the active person."""
    if not actor.person_id:
        return {"has_workspace": False, "sign_offs": [], "work_orders": []}
    team_assigned = (
        await session.execute(
            select(episode_team_assignments.c.id)
            .where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.person_id == actor.person_id,
                )
            )
            .limit(1)
        )
    ).first()
    work_orders = (
        await session.execute(
            select(
                post_work_orders.c.id,
                post_work_orders.c.episode_id,
                post_work_orders.c.booking_id,
                post_work_orders.c.work_type,
                post_work_orders.c.kind,
                post_work_orders.c.title,
                post_work_orders.c.description,
                post_work_orders.c.is_blocking,
                post_work_orders.c.status,
                post_work_orders.c.due_at,
                post_work_orders.c.external_url,
                shows.c.id.label("show_id"),
                shows.c.title.label("show_title"),
                episodes.c.title.label("episode_title"),
                episodes.c.number.label("episode_number"),
                episodes.c.workflow_status,
                workflow_stages.c.name.label("workflow_stage_name"),
            )
            .select_from(post_work_orders)
            .join(
                episodes,
                and_(
                    episodes.c.id == post_work_orders.c.episode_id,
                    episodes.c.organization_id == actor.organization_id,
                ),
            )
            .join(
                seasons,
                and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
            )
            .join(
                shows,
                and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id),
            )
            .outerjoin(
                workflow_stages,
                and_(
                    workflow_stages.c.id == post_work_orders.c.workflow_stage_id,
                    workflow_stages.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    post_work_orders.c.organization_id == actor.organization_id,
                    # My Work is an operational inbox, not an approval queue.
                    # An assignee cannot reserve a room or record time until a
                    # manager has approved the work order, so do not surface
                    # draft, submitted, or returned work as actionable work.
                    post_work_orders.c.status.in_(("in_progress", "ready_for_review")),
                    post_work_orders.c.assignee_person_id == actor.person_id,
                )
            )
            .order_by(post_work_orders.c.due_at.asc().nulls_last(), post_work_orders.c.created_at)
        )
    ).all()
    sign_offs: list[dict[str, object]] = []
    if "sign_off_work" in actor.permissions:
        approvals = (
            await session.execute(
                select(
                    episode_workflow_approvals.c.id,
                    episode_workflow_approvals.c.episode_id,
                    episode_workflow_approvals.c.workflow_stage_id,
                    episode_workflow_approvals.c.approval_rule_id,
                    episode_workflow_approvals.c.status,
                    episode_workflow_approvals.c.required_person_id,
                    workflow_stage_approval_rules.c.label,
                    workflow_stage_approval_rules.c.approval_order,
                    workflow_stage_approval_rules.c.is_required,
                    workflow_stages.c.name.label("stage_name"),
                    workflow_stages.c.position.label("stage_position"),
                    shows.c.id.label("show_id"),
                    shows.c.title.label("show_title"),
                    episodes.c.title.label("episode_title"),
                    episodes.c.number.label("episode_number"),
                    episodes.c.updated_at.label("passed_at"),
                )
                .select_from(episode_workflow_approvals)
                .join(
                    episodes,
                    and_(
                        episodes.c.id == episode_workflow_approvals.c.episode_id,
                        episodes.c.organization_id == actor.organization_id,
                        episodes.c.workflow_stage_id == episode_workflow_approvals.c.workflow_stage_id,
                        episodes.c.workflow_status == "awaiting_sign_off",
                    ),
                )
                .join(
                    seasons,
                    and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
                )
                .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
                .join(
                    workflow_stages,
                    and_(
                        workflow_stages.c.id == episode_workflow_approvals.c.workflow_stage_id,
                        workflow_stages.c.organization_id == actor.organization_id,
                    ),
                )
                .join(
                    workflow_stage_approval_rules,
                    and_(
                        workflow_stage_approval_rules.c.id == episode_workflow_approvals.c.approval_rule_id,
                        workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                    ),
                )
                .where(episode_workflow_approvals.c.organization_id == actor.organization_id)
                .order_by(workflow_stages.c.position, workflow_stage_approval_rules.c.approval_order)
            )
        ).all()
        approved_by_stage: dict[str, set[str]] = {}
        for approval in approvals:
            if approval.status == "approved":
                approved_by_stage.setdefault(f"{approval.episode_id}:{approval.workflow_stage_id}", set()).add(
                    str(approval.approval_rule_id)
                )
        for approval in approvals:
            stage_key = f"{approval.episode_id}:{approval.workflow_stage_id}"
            approved = approved_by_stage.get(stage_key, set())
            earlier_required_pending = any(
                candidate.episode_id == approval.episode_id
                and candidate.workflow_stage_id == approval.workflow_stage_id
                and candidate.is_required
                and candidate.approval_order < approval.approval_order
                and str(candidate.approval_rule_id) not in approved
                for candidate in approvals
            )
            if (
                approval.status == "pending"
                and str(approval.required_person_id or "") == actor.person_id
                and not earlier_required_pending
            ):
                sign_offs.append(
                    {
                        "id": f"{approval.episode_id}:{approval.approval_rule_id}",
                        "approval_rule_id": str(approval.approval_rule_id),
                        "episode_id": str(approval.episode_id),
                        "show_id": str(approval.show_id),
                        "workflow_stage_id": str(approval.workflow_stage_id),
                        "stage_name": approval.stage_name,
                        "stage_position": approval.stage_position,
                        "sign_off_label": approval.label,
                        "approver_role": None,
                        "approval_order": approval.approval_order,
                        "is_required": approval.is_required,
                        "passed_at": approval.passed_at,
                        "show_title": approval.show_title,
                        "episode_title": approval.episode_title,
                        "episode_number": approval.episode_number,
                    }
                )
    return {
        "has_workspace": bool(team_assigned or work_orders),
        "sign_offs": sign_offs,
        "work_orders": [
            {
                "id": str(item.id),
                "episode_id": str(item.episode_id),
                "booking_id": str(item.booking_id) if item.booking_id else None,
                "work_type": item.work_type,
                "show_id": str(item.show_id),
                "show_title": item.show_title,
                "episode_title": item.episode_title,
                "episode_number": item.episode_number,
                "workflow_stage_name": item.workflow_stage_name,
                "kind": item.kind,
                "title": item.title,
                "description": item.description,
                "is_blocking": item.is_blocking,
                "status": item.status,
                "due_at": item.due_at,
                "external_url": item.external_url,
                "workflow_state": {
                    "display_status": item.workflow_status,
                    "primary_stage_name": item.workflow_stage_name,
                },
            }
            for item in work_orders
        ],
    }
