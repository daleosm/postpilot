"""Shared, tenant-safe projections for the core production API."""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import Actor, has_permission
from app.db.tables import episode_team_assignments, episodes


async def may_view_all_episodes(session: AsyncSession, actor: Actor) -> bool:
    """Whether an internal actor may see a tenant's full episode slate."""
    if actor.active_organization and actor.active_organization.role == "client":
        return False
    return any(
        [
            await has_permission(session, actor, "manage_production"),
            await has_permission(session, actor, "view_all_operations"),
        ]
    )


def assigned_episode_condition(actor: Actor):
    """The narrow record predicate used when an actor only has assigned work."""
    if not actor.person_id:
        # A false condition which does not leak whether an episode exists.
        return episodes.c.id.is_(None)
    return or_(
        episodes.c.assigned_producer_id == actor.person_id,
        episodes.c.editor_id == actor.person_id,
        episodes.c.colorist_id == actor.person_id,
        episodes.c.sound_mixer_id == actor.person_id,
        select(episode_team_assignments.c.id)
        .where(
            and_(
                episode_team_assignments.c.organization_id == actor.organization_id,
                episode_team_assignments.c.episode_id == episodes.c.id,
                episode_team_assignments.c.person_id == actor.person_id,
            )
        )
        .exists(),
    )


async def require_episode_access(session: AsyncSession, actor: Actor, episode_id: str) -> None:
    """Resolve access with a 404 for foreign or non-assigned episodes."""
    condition = True if await may_view_all_episodes(session, actor) else assigned_episode_condition(actor)
    record = (
        await session.execute(
            select(episodes.c.id).where(
                and_(
                    episodes.c.id == episode_id,
                    episodes.c.organization_id == actor.organization_id,
                    condition,
                )
            )
        )
    ).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")


async def require_show_access(session: AsyncSession, actor: Actor, show_id: str) -> None:
    """Show access follows the episode scope for non-manager accounts."""
    from app.db.tables import seasons, shows

    if await may_view_all_episodes(session, actor):
        condition = True
    else:
        condition = assigned_episode_condition(actor)
    record = (
        await session.execute(
            select(shows.c.id)
            .join(seasons, and_(seasons.c.show_id == shows.c.id, seasons.c.organization_id == actor.organization_id))
            .join(
                episodes,
                and_(
                    episodes.c.season_id == seasons.c.id,
                    episodes.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    shows.c.id == show_id,
                    shows.c.organization_id == actor.organization_id,
                    condition,
                )
            )
            .limit(1)
        )
    ).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")


def workflow_projection(row: object) -> dict[str, object]:
    """Expose one current-stage state, never the mutable legacy status field."""
    workflow_status = row.workflow_status
    stage_name = row.workflow_stage_name
    label = (
        f"Awaiting sign-off · {stage_name or 'workflow'}"
        if workflow_status == "awaiting_sign_off"
        else f"Blocked · {stage_name or 'workflow'}"
        if workflow_status == "blocked"
        else "Complete"
        if workflow_status == "complete"
        else stage_name or "Not started"
    )
    return {
        "workflow_status": workflow_status,
        "workflow_stage_id": row.workflow_stage_id,
        "workflow_stage": stage_name,
        "workflow_label": label,
    }


def ids(values: Sequence[str | None]) -> list[str]:
    return list({value for value in values if value})
