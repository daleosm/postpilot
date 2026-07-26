from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import Text, and_, cast, desc, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import assigned_episode_condition, may_view_all_episodes, require_show_access
from app.api.schemas import ShowCreateRequest, ShowUpdateRequest
from app.auth import has_permission, require_permission
from app.db.tables import (
    activity_log,
    budget_lines,
    crm_companies,
    crm_contacts,
    episode_team_assignments,
    episodes,
    people,
    seasons,
    show_contacts,
    shows,
)

router = APIRouter(prefix="/shows", tags=["shows"])


def _show_response(
    row: object,
    season_rows: list[object],
    episode_rows: list[object],
    budget_health: int | None = None,
) -> dict[str, object]:
    season_map = {season.id: season for season in season_rows if season.show_id == row.id}
    episode_count = sum(episode.season_id in season_map for episode in episode_rows)
    active_episode_count = sum(
        episode.season_id in season_map and episode.workflow_status != "complete" for episode in episode_rows
    )
    return {
        "id": row.id,
        "title": row.title,
        "code": row.code,
        "network": row.network,
        "production_company": row.production_company,
        "client_company_id": row.client_company_id,
        "production_company_id": row.production_company_id,
        "description": row.description,
        "time_zone": row.time_zone,
        "season_count": len(season_map),
        "seasons": [
            {"id": season.id, "number": season.number, "title": season.title}
            for season in sorted(season_map.values(), key=lambda season: season.number)
        ],
        "episode_count": episode_count,
        "active_episode_count": active_episode_count,
        "budget_health": budget_health,
    }


async def _tenant_company(session: DbSession, organization_id: str, company_id: str | None) -> bool:
    if not company_id:
        return True
    return bool(
        (
            await session.execute(
                select(crm_companies.c.id).where(
                    and_(crm_companies.c.id == company_id, crm_companies.c.organization_id == organization_id)
                )
            )
        ).first()
    )


@router.get("")
async def list_shows(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    # Artists and clients receive only shows containing an assigned episode;
    # managers and operational observers receive the complete tenant slate.
    visible_all = await may_view_all_episodes(session, actor)
    where = shows.c.organization_id == actor.organization_id
    if not visible_all:
        where = and_(
            where,
            select(episodes.c.id)
            .join(seasons, seasons.c.id == episodes.c.season_id)
            .where(
                and_(
                    seasons.c.show_id == shows.c.id,
                    episodes.c.organization_id == actor.organization_id,
                    assigned_episode_condition(actor),
                )
            )
            .exists(),
        )
    show_rows = (await session.execute(select(shows).where(where).order_by(shows.c.title, shows.c.id))).all()
    episode_conditions = [episodes.c.organization_id == actor.organization_id]
    if not visible_all:
        episode_conditions.append(assigned_episode_condition(actor))
    episode_rows = (
        await session.execute(select(episodes.c.season_id, episodes.c.workflow_status).where(and_(*episode_conditions)))
    ).all()
    show_ids = [row.id for row in show_rows]
    visible_season_ids = [row.season_id for row in episode_rows]
    season_condition = [
        seasons.c.organization_id == actor.organization_id,
        seasons.c.show_id.in_(show_ids),
    ]
    if not visible_all:
        season_condition.append(seasons.c.id.in_(visible_season_ids))
    season_rows = (
        (await session.execute(select(seasons).where(and_(*season_condition)).order_by(seasons.c.number))).all()
        if show_ids and (visible_all or visible_season_ids)
        else []
    )

    # Spend is commercial data. Operational artists can still see their show
    # slate without receiving budget values merely through the overview.
    budget_health_by_show: dict[str, int] = {}
    if show_ids and await has_permission(session, actor, "manage_commercial"):
        budget_rows = (
            await session.execute(
                select(
                    budget_lines.c.show_id,
                    func.coalesce(func.sum(budget_lines.c.budgeted_amount), 0).label("budgeted"),
                    func.coalesce(func.sum(budget_lines.c.actual_amount), 0).label("actual"),
                )
                .where(
                    and_(
                        budget_lines.c.organization_id == actor.organization_id,
                        budget_lines.c.show_id.in_(show_ids),
                    )
                )
                .group_by(budget_lines.c.show_id)
            )
        ).all()
        for budget in budget_rows:
            budgeted = float(budget.budgeted)
            budget_health_by_show[str(budget.show_id)] = (
                round((float(budget.actual) / budgeted) * 100) if budgeted else 0
            )

    return {
        "shows": [
            _show_response(row, season_rows, episode_rows, budget_health_by_show.get(str(row.id))) for row in show_rows
        ]
    }


@router.get("/options/form")
async def production_form_options(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Tenant-scoped data needed by the show and episode create forms.

    The browser never receives an organisation identifier and cannot use this
    endpoint as a directory lookup outside its active post house.
    """
    await require_permission(session, actor, "manage_production")
    companies, people_rows, season_rows = await _form_options(session, actor.organization_id)
    return {
        "companies": [{"id": company.id, "name": company.name, "type": company.type} for company in companies],
        "people": [{"id": person.id, "name": person.name, "role": person.role} for person in people_rows],
        "seasons": [
            {"id": season.id, "label": f"{season.show_title} · Season {season.number}"} for season in season_rows
        ],
    }


async def _form_options(session: DbSession, organization_id: str) -> tuple[list[object], list[object], list[object]]:
    # The requests share one AsyncSession, so execute them serially rather than
    # risking concurrent use of its connection.
    companies = await session.execute(
        select(crm_companies.c.id, crm_companies.c.name, crm_companies.c.type)
        .where(crm_companies.c.organization_id == organization_id)
        .order_by(crm_companies.c.name)
    )
    people_rows = await session.execute(
        select(people.c.id, people.c.name, people.c.role)
        .where(and_(people.c.organization_id == organization_id, people.c.is_active.is_(True)))
        .order_by(people.c.name)
    )
    season_rows = await session.execute(
        select(seasons.c.id, seasons.c.number, shows.c.title.label("show_title"))
        .join(shows, shows.c.id == seasons.c.show_id)
        .where(
            and_(
                seasons.c.organization_id == organization_id,
                shows.c.organization_id == organization_id,
            )
        )
        .order_by(shows.c.title, seasons.c.number)
    )
    return companies.all(), people_rows.all(), season_rows.all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_show(payload: ShowCreateRequest, actor: CurrentActor, session: DbSession) -> dict[str, str]:
    await require_permission(session, actor, "manage_production")
    client_company_is_valid = await _tenant_company(session, actor.organization_id, payload.client_company_id)
    production_company_is_valid = await _tenant_company(session, actor.organization_id, payload.production_company_id)
    if not client_company_is_valid or not production_company_is_valid:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CRM company not found for this post house.")
    try:
        result = await session.execute(
            insert(shows)
            .values(
                organization_id=actor.organization_id,
                title=payload.title.strip(),
                code=payload.code.strip().upper(),
                network=payload.network.strip() if payload.network else None,
                production_company=payload.production_company.strip() if payload.production_company else None,
                client_company_id=payload.client_company_id,
                production_company_id=payload.production_company_id,
                description=payload.description.strip() if payload.description else None,
                time_zone="Europe/London",
            )
            .returning(shows.c.id)
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That show code already exists in this post house.",
        ) from error
    return {"id": result.scalar_one()}


@router.get("/{show_id}/workspace")
async def get_show_workspace(show_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """The tenant-scoped read model for the operational Show detail screen."""
    await require_show_access(session, actor, show_id)
    visible_all = await may_view_all_episodes(session, actor)
    show_row = (
        await session.execute(
            select(shows).where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
        )
    ).first()
    if not show_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")

    # Reuse the single episode projection so list, detail, and dashboard never
    # disagree about the current workflow status or active-stage label.
    from app.api.routes.episodes import _episode_response, _episode_rows

    episode_rows = await _episode_rows(session, actor, show_id=show_id)
    episode_payload = [_episode_response(row) for row in episode_rows]
    visible_season_ids = {row.season_id for row in episode_rows}
    season_conditions = [
        seasons.c.organization_id == actor.organization_id,
        seasons.c.show_id == show_id,
    ]
    if not visible_all:
        season_conditions.append(seasons.c.id.in_(visible_season_ids))
    season_rows = (
        (await session.execute(select(seasons).where(and_(*season_conditions)).order_by(seasons.c.number))).all()
        if visible_all or visible_season_ids
        else []
    )

    episode_ids = [row.id for row in episode_rows]
    team_rows = (
        (
            await session.execute(
                select(
                    people.c.id.label("person_id"),
                    people.c.name,
                    people.c.role,
                    episodes.c.id.label("episode_id"),
                    episodes.c.number.label("episode_number"),
                    episodes.c.title.label("episode_title"),
                    seasons.c.number.label("season_number"),
                )
                .select_from(episode_team_assignments)
                .join(episodes, episodes.c.id == episode_team_assignments.c.episode_id)
                .join(seasons, seasons.c.id == episodes.c.season_id)
                .join(people, people.c.id == episode_team_assignments.c.person_id)
                .where(
                    and_(
                        episode_team_assignments.c.organization_id == actor.organization_id,
                        episodes.c.organization_id == actor.organization_id,
                        seasons.c.organization_id == actor.organization_id,
                        people.c.organization_id == actor.organization_id,
                        episodes.c.id.in_(episode_ids),
                    )
                )
                .order_by(people.c.name, seasons.c.number, episodes.c.number)
            )
        ).all()
        if episode_ids
        else []
    )
    team_by_person: dict[str, dict[str, object]] = {}
    for team_member in team_rows:
        person = team_by_person.setdefault(
            str(team_member.person_id),
            {
                "id": team_member.person_id,
                "name": team_member.name,
                "role": team_member.role,
                "episodes": [],
            },
        )
        person["episodes"].append(
            {
                "id": team_member.episode_id,
                "number": team_member.episode_number,
                "title": team_member.episode_title,
                "season_number": team_member.season_number,
            }
        )

    contacts = (
        await session.execute(
            select(
                show_contacts.c.responsibility,
                crm_contacts.c.name,
                crm_contacts.c.title,
                crm_contacts.c.email,
                crm_contacts.c.phone,
                crm_companies.c.name.label("company_name"),
            )
            .select_from(show_contacts)
            .join(crm_contacts, crm_contacts.c.id == show_contacts.c.contact_id)
            .join(crm_companies, crm_companies.c.id == crm_contacts.c.company_id)
            .where(
                and_(
                    show_contacts.c.organization_id == actor.organization_id,
                    show_contacts.c.show_id == show_id,
                    crm_contacts.c.organization_id == actor.organization_id,
                    crm_companies.c.organization_id == actor.organization_id,
                )
            )
            .order_by(show_contacts.c.responsibility)
        )
    ).all()

    # This is intentionally limited to completed-stage events attached to an
    # episode in this show. It does not expose tenant-wide commercial activity.
    activity_conditions = [
        activity_log.c.organization_id == actor.organization_id,
        activity_log.c.entity_type == "episode",
        activity_log.c.action == "workflow.stage_completed",
        episodes.c.organization_id == actor.organization_id,
        seasons.c.organization_id == actor.organization_id,
        seasons.c.show_id == show_id,
    ]
    if not visible_all:
        activity_conditions.append(episodes.c.id.in_(episode_ids))
    activity = (
        await session.execute(
            select(
                activity_log.c.id,
                activity_log.c.action,
                activity_log.c.metadata,
                activity_log.c.created_at,
                episodes.c.id.label("episode_id"),
                episodes.c.number.label("episode_number"),
                episodes.c.title.label("episode_title"),
                seasons.c.number.label("season_number"),
            )
            .select_from(activity_log)
            .join(episodes, activity_log.c.entity_id == cast(episodes.c.id, Text))
            .join(seasons, seasons.c.id == episodes.c.season_id)
            .where(and_(*activity_conditions))
            .order_by(desc(activity_log.c.created_at))
            .limit(8)
        )
    ).all()

    seasons_payload = []
    for season in season_rows:
        season_episodes = [item for item in episode_payload if item["season_id"] == season.id]
        seasons_payload.append(
            {
                "id": season.id,
                "number": season.number,
                "title": season.title,
                "episode_count": len(season_episodes),
                "active_count": sum(item["workflow_status"] != "complete" for item in season_episodes),
            }
        )

    people_rows = []
    companies = []
    if await has_permission(session, actor, "manage_production"):
        people_rows = (
            await session.execute(
                select(people.c.id, people.c.name, people.c.role)
                .where(and_(people.c.organization_id == actor.organization_id, people.c.is_active.is_(True)))
                .order_by(people.c.name)
            )
        ).all()
        companies = (
            await session.execute(
                select(crm_companies.c.id, crm_companies.c.name, crm_companies.c.type)
                .where(crm_companies.c.organization_id == actor.organization_id)
                .order_by(crm_companies.c.name)
            )
        ).all()

    return {
        "show": _show_response(show_row, season_rows, episode_rows),
        "seasons": seasons_payload,
        "episodes": episode_payload,
        "team": list(team_by_person.values()),
        "people": [{"id": person.id, "name": person.name, "role": person.role} for person in people_rows],
        "companies": [{"id": company.id, "name": company.name, "type": company.type} for company in companies],
        "contacts": [
            {
                "responsibility": contact.responsibility,
                "name": contact.name,
                "title": contact.title,
                "email": contact.email,
                "phone": contact.phone,
                "company_name": contact.company_name,
            }
            for contact in contacts
        ],
        "activity": [
            {
                "id": item.id,
                "action": item.action,
                "metadata": item.metadata,
                "created_at": item.created_at,
                "episode_id": item.episode_id,
                "episode_number": item.episode_number,
                "episode_title": item.episode_title,
                "season_number": item.season_number,
            }
            for item in activity
        ],
    }


@router.get("/{show_id}")
async def get_show(show_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_show_access(session, actor, show_id)
    visible_all = await may_view_all_episodes(session, actor)
    show_row = (
        await session.execute(
            select(shows).where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
        )
    ).first()
    if not show_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    episode_conditions = [
        episodes.c.organization_id == actor.organization_id,
        seasons.c.organization_id == actor.organization_id,
        seasons.c.show_id == show_id,
    ]
    if not visible_all:
        episode_conditions.append(assigned_episode_condition(actor))
    episode_rows = (
        await session.execute(
            select(episodes.c.id, episodes.c.season_id, episodes.c.number, episodes.c.title, episodes.c.workflow_status)
            .join(seasons, seasons.c.id == episodes.c.season_id)
            .where(and_(*episode_conditions))
            .order_by(seasons.c.number, episodes.c.number)
        )
    ).all()
    visible_season_ids = [episode.season_id for episode in episode_rows]
    season_rows = (
        (
            await session.execute(
                select(seasons)
                .where(
                    and_(
                        seasons.c.show_id == show_id,
                        seasons.c.organization_id == actor.organization_id,
                        seasons.c.id.in_(visible_season_ids),
                    )
                )
                .order_by(seasons.c.number)
            )
        ).all()
        if visible_season_ids
        else []
    )
    return {
        "show": _show_response(show_row, season_rows, episode_rows),
        "seasons": [
            {"id": season.id, "number": season.number, "title": season.title, "start_date": season.start_date}
            for season in season_rows
        ],
        "episodes": [
            {
                "id": episode.id,
                "season_id": episode.season_id,
                "number": episode.number,
                "title": episode.title,
                "workflow_status": episode.workflow_status,
            }
            for episode in episode_rows
        ],
    }


@router.patch("/{show_id}")
async def update_show(
    show_id: str, payload: ShowUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, str]:
    await require_permission(session, actor, "manage_production")
    await require_show_access(session, actor, show_id)
    values = payload.model_dump(exclude_unset=True)
    for key in ("title", "code", "network", "production_company", "description"):
        if key in values and isinstance(values[key], str):
            values[key] = values[key].strip() or None
    if values.get("code") is None and "code" in values:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Show code is required.")
    if "code" in values:
        values["code"] = values["code"].upper()
    for key in ("client_company_id", "production_company_id"):
        if key in values and not await _tenant_company(session, actor.organization_id, values[key]):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="CRM company not found for this post house.",
            )
    if not values:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide at least one show change.",
        )
    values["updated_at"] = datetime.now(UTC)
    try:
        result = await session.execute(
            update(shows)
            .where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
            .values(**values)
            .returning(shows.c.id)
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That show code already exists in this post house.",
        ) from error
    if not result.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    return {"id": show_id}
