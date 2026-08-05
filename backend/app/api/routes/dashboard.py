from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import and_, func, or_, select

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import may_view_all_episodes
from app.api.routes.episodes import _episode_response, _episode_rows
from app.api.routes.shows import list_shows
from app.auth import has_permission
from app.db.tables import (
    activity_log,
    bookings,
    budget_lines,
    episodes,
    people,
    post_work_orders,
    rooms,
    seasons,
    shows,
    workflow_stages,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """A current tenant dashboard; assigned users receive only their scoped work."""
    episode_rows = await _episode_rows(session, actor)
    all_operations = await may_view_all_episodes(session, actor)
    activity_query = (
        select(
            activity_log.c.id,
            activity_log.c.action,
            activity_log.c.entity_type,
            activity_log.c.entity_id,
            activity_log.c.metadata,
            activity_log.c.created_at,
        )
        .where(activity_log.c.organization_id == actor.organization_id)
        .order_by(activity_log.c.created_at.desc())
        .limit(10)
    )
    # Narrow actors' event history is intentionally omitted until each feature
    # activity stream has its own explicit assignment/share rule. Returning the
    # tenant feed here would leak episode titles and commercial activity.
    activity = (await session.execute(activity_query)).all() if all_operations else []
    now = datetime.now(UTC)
    end_of_week = now + timedelta(days=7)
    booking_conditions = [
        bookings.c.organization_id == actor.organization_id,
        bookings.c.starts_at < end_of_week,
        bookings.c.ends_at > now,
    ]
    if not all_operations:
        # Artists receive their own scheduled work only. Unlinked facility
        # holds are never exposed through this fallback.
        if actor.person_id:
            booking_conditions.append(bookings.c.person_id == actor.person_id)
        else:
            booking_conditions.append(bookings.c.id.is_(None))
    schedule = (
        await session.execute(
            select(
                bookings.c.id,
                bookings.c.title,
                bookings.c.starts_at,
                bookings.c.ends_at,
                rooms.c.name.label("room_name"),
                people.c.name.label("person_name"),
            )
            .select_from(bookings)
            .outerjoin(rooms, and_(rooms.c.id == bookings.c.room_id, rooms.c.organization_id == actor.organization_id))
            .outerjoin(
                people, and_(people.c.id == bookings.c.person_id, people.c.organization_id == actor.organization_id)
            )
            .where(and_(*booking_conditions))
            .order_by(bookings.c.starts_at)
        )
    ).all()

    team_conditions = [people.c.organization_id == actor.organization_id, people.c.is_active.is_(True)]
    if not all_operations:
        team_conditions.append(people.c.id == actor.person_id if actor.person_id else people.c.id.is_(None))
    team = (
        await session.execute(
            select(people.c.id, people.c.name, people.c.role).where(and_(*team_conditions)).order_by(people.c.name)
        )
    ).all()

    # The command centre is an exception queue, not another work-order list.
    # Surface only work that needs a coordinator's attention: overdue or near
    # due work, work without an owner, and blockers holding a stage that is
    # otherwise waiting for sign-off.
    work_order_attention_conditions = [
        post_work_orders.c.organization_id == actor.organization_id,
        post_work_orders.c.status.not_in(("complete", "cancelled")),
    ]
    if not all_operations:
        if not actor.person_id or (actor.active_organization and actor.active_organization.role == "client"):
            work_order_attention_conditions.append(post_work_orders.c.id.is_(None))
        else:
            work_order_attention_conditions.append(
                post_work_orders.c.assignee_person_id == actor.person_id
            )
    work_order_attention_conditions.append(
        or_(
            post_work_orders.c.due_at <= now + timedelta(hours=48),
            post_work_orders.c.assignee_person_id.is_(None),
            and_(
                post_work_orders.c.is_blocking.is_(True),
                episodes.c.workflow_status == "awaiting_sign_off",
                post_work_orders.c.workflow_stage_id.is_not(None),
                post_work_orders.c.workflow_stage_id == episodes.c.workflow_stage_id,
            ),
        )
    )
    work_order_attention = (
        await session.execute(
            select(
                post_work_orders.c.id,
                post_work_orders.c.title,
                post_work_orders.c.priority,
                post_work_orders.c.status,
                post_work_orders.c.due_at,
                post_work_orders.c.is_blocking,
                post_work_orders.c.assignee_person_id,
                post_work_orders.c.workflow_stage_id.label("work_order_stage_id"),
                episodes.c.id.label("episode_id"),
                episodes.c.title.label("episode_title"),
                episodes.c.number.label("episode_number"),
                episodes.c.workflow_stage_id.label("episode_workflow_stage_id"),
                episodes.c.workflow_status.label("episode_workflow_status"),
                shows.c.title.label("show_title"),
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
            .where(and_(*work_order_attention_conditions))
            .order_by(post_work_orders.c.due_at.asc().nulls_last(), post_work_orders.c.created_at.desc())
            .limit(25)
        )
    ).all()

    budget = None
    if await has_permission(session, actor, "manage_commercial"):
        budget_row = (
            await session.execute(
                select(
                    func.coalesce(func.sum(budget_lines.c.budgeted_amount), 0).label("budgeted"),
                    func.coalesce(func.sum(budget_lines.c.actual_amount), 0).label("actual"),
                ).where(budget_lines.c.organization_id == actor.organization_id)
            )
        ).one()
        budget = {"budgeted": float(budget_row.budgeted), "actual": float(budget_row.actual)}

    show_data = await list_shows(actor, session)
    return {
        "metrics": {
            "active_episodes": sum(row.workflow_status not in {"complete", "not_started"} for row in episode_rows),
            "episodes_awaiting_sign_off": sum(row.workflow_status == "awaiting_sign_off" for row in episode_rows),
            "qc_attention": sum(row.qc_status == "needs_attention" for row in episode_rows),
            "upcoming_deliveries": sum(row.delivery_deadline is not None for row in episode_rows),
        },
        "episodes": [_episode_response(row) for row in episode_rows],
        "shows": show_data["shows"],
        "schedule": [
            {
                "id": booking.id,
                "title": booking.title,
                "starts_at": booking.starts_at,
                "ends_at": booking.ends_at,
                "room_name": booking.room_name,
                "person_name": booking.person_name,
            }
            for booking in schedule
        ],
        "team": [{"id": person.id, "name": person.name, "role": person.role} for person in team],
        "work_order_attention": [
            {
                "id": item.id,
                "title": item.title,
                "priority": item.priority,
                "status": item.status,
                "due_at": item.due_at,
                "is_blocking": item.is_blocking,
                "assignee_person_id": item.assignee_person_id,
                "work_order_stage_id": item.work_order_stage_id,
                "episode_id": item.episode_id,
                "episode_title": item.episode_title,
                "episode_number": item.episode_number,
                "episode_workflow_stage_id": item.episode_workflow_stage_id,
                "episode_workflow_status": item.episode_workflow_status,
                "show_title": item.show_title,
                "workflow_stage_name": item.workflow_stage_name,
            }
            for item in work_order_attention
        ],
        "budget": budget,
        "activity": [
            {
                "id": item.id,
                "action": item.action,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "metadata": item.metadata,
                "created_at": item.created_at,
            }
            for item in activity
        ],
    }
