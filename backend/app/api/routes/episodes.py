from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, delete, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import (
    assigned_episode_condition,
    ids,
    may_view_all_episodes,
    require_episode_access,
    workflow_projection,
)
from app.api.schemas import (
    EpisodeCreateRequest,
    EpisodeTeamAddRequest,
    EpisodeTeamSignerRequest,
    EpisodeUpdateRequest,
    WorkflowActionRequest,
)
from app.auth import has_permission, require_permission
from app.db.tables import (
    activity_log,
    bookings,
    budget_lines,
    crm_companies,
    crm_contacts,
    delivery_profile_items,
    delivery_profiles,
    episode_delivery_acceptance_exceptions,
    episode_delivery_items,
    episode_delivery_manifests,
    episode_team_assignments,
    episode_workflow_approvals,
    episode_workflow_exceptions,
    episodes,
    people,
    post_work_order_items,
    post_work_orders,
    post_workflows,
    purchase_orders,
    qc_issues,
    qc_reports,
    rooms,
    seasons,
    shows,
    workflow_stage_approval_rules,
    workflow_stage_work_order_templates,
    workflow_stages,
)

router = APIRouter(prefix="/episodes", tags=["episodes"])


@router.get("/seasons/{season_id}/last-episode-team")
async def last_episode_team_for_season(season_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return only the prior episode's tenant-scoped team for the create form."""
    await require_permission(session, actor, "manage_production")
    season = (
        await session.execute(
            select(seasons.c.id)
            .join(shows, shows.c.id == seasons.c.show_id)
            .where(
                and_(
                    seasons.c.id == season_id,
                    seasons.c.organization_id == actor.organization_id,
                    shows.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not season:
        # An empty season is a valid operational state; a foreign or unknown
        # ID is not. Keeping those outcomes distinct prevents a tenant user
        # from probing another post house through the copy-team control.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found.")
    previous_episode = (
        await session.execute(
            select(episodes.c.id)
            .select_from(seasons)
            .join(shows, shows.c.id == seasons.c.show_id)
            .join(episodes, episodes.c.season_id == seasons.c.id)
            .where(
                and_(
                    seasons.c.id == season_id,
                    seasons.c.organization_id == actor.organization_id,
                    shows.c.organization_id == actor.organization_id,
                    episodes.c.season_id == season_id,
                    episodes.c.organization_id == actor.organization_id,
                )
            )
            .order_by(episodes.c.number.desc(), episodes.c.created_at.desc())
            .limit(1)
        )
    ).first()
    if not previous_episode:
        return {"team": []}
    team = (
        await session.execute(
            select(episode_team_assignments.c.person_id)
            .join(people, people.c.id == episode_team_assignments.c.person_id)
            .where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == previous_episode.id,
                    people.c.organization_id == actor.organization_id,
                )
            )
            .order_by(people.c.name)
        )
    ).all()
    return {"team": [{"person_id": item.person_id} for item in team]}


def _episode_fields():
    editor = people.alias("episode_editor")
    producer = people.alias("episode_producer")
    return (
        editor,
        producer,
        [
            episodes.c.id,
            episodes.c.title,
            episodes.c.number,
            episodes.c.production_code,
            episodes.c.qc_status,
            episodes.c.air_date,
            episodes.c.locked_cut_date,
            episodes.c.delivery_deadline,
            episodes.c.workflow_status,
            episodes.c.workflow_stage_id,
            shows.c.id.label("show_id"),
            shows.c.title.label("show_title"),
            shows.c.network,
            seasons.c.id.label("season_id"),
            seasons.c.number.label("season_number"),
            workflow_stages.c.name.label("workflow_stage_name"),
            workflow_stages.c.key.label("workflow_stage_key"),
            workflow_stages.c.color.label("workflow_stage_color"),
            editor.c.name.label("editor_name"),
            producer.c.name.label("producer_name"),
        ],
    )


def _episode_response(row: object) -> dict[str, object]:
    return {
        "id": row.id,
        "title": row.title,
        "number": row.number,
        "production_code": row.production_code,
        "qc_status": row.qc_status,
        "air_date": row.air_date,
        "locked_cut_date": row.locked_cut_date,
        "delivery_deadline": row.delivery_deadline,
        "show_id": row.show_id,
        "show_title": row.show_title,
        "network": row.network,
        "season_id": row.season_id,
        "season_number": row.season_number,
        "editor_name": row.editor_name,
        "producer_name": row.producer_name,
        "workflow_stage_key": row.workflow_stage_key,
        "workflow_stage_color": row.workflow_stage_color,
        **workflow_projection(row),
    }


async def _episode_rows(
    session: DbSession, actor: CurrentActor, *, show_id: str | None = None, episode_id: str | None = None
) -> list[object]:
    editor, producer, fields = _episode_fields()
    conditions = [
        episodes.c.organization_id == actor.organization_id,
        seasons.c.organization_id == actor.organization_id,
        shows.c.organization_id == actor.organization_id,
    ]
    if show_id:
        conditions.append(shows.c.id == show_id)
    if episode_id:
        conditions.append(episodes.c.id == episode_id)
    if not await may_view_all_episodes(session, actor):
        conditions.append(assigned_episode_condition(actor))
    query = (
        select(*fields)
        .select_from(episodes)
        .join(seasons, episodes.c.season_id == seasons.c.id)
        .join(shows, seasons.c.show_id == shows.c.id)
        .outerjoin(workflow_stages, workflow_stages.c.id == episodes.c.workflow_stage_id)
        .outerjoin(
            editor,
            and_(editor.c.id == episodes.c.editor_id, editor.c.organization_id == actor.organization_id),
        )
        .outerjoin(
            producer,
            and_(producer.c.id == episodes.c.assigned_producer_id, producer.c.organization_id == actor.organization_id),
        )
        .where(and_(*conditions))
        .order_by(shows.c.title, seasons.c.number, episodes.c.number)
    )
    return (await session.execute(query)).all()


async def _tenant_people(session: DbSession, organization_id: str, person_ids: list[str]) -> set[str]:
    if not person_ids:
        return set()
    rows = (
        await session.execute(
            select(people.c.id).where(and_(people.c.organization_id == organization_id, people.c.id.in_(person_ids)))
        )
    ).scalars()
    return set(rows)


async def _create_delivery_manifest_for_new_episode(
    session: DbSession,
    *,
    organization_id: str,
    actor_user_id: str,
    episode_id: str,
    show: object,
    delivery_deadline: datetime | None,
) -> None:
    """Copy the show-selected delivery profile without sharing profile rows.

    Episode manifests are intentionally snapshots: subsequent profile edits
    must not rewrite an already-created episode's delivery requirements.
    """
    if not show.delivery_profile_id:
        return
    profile = (
        await session.execute(
            select(delivery_profiles).where(
                and_(
                    delivery_profiles.c.id == show.delivery_profile_id,
                    delivery_profiles.c.organization_id == organization_id,
                    delivery_profiles.c.is_active.is_(True),
                )
            )
        )
    ).first()
    if not profile:
        return
    if (
        (profile.show_id and profile.show_id != show.show_id)
        or (profile.client_company_id and profile.client_company_id != show.client_company_id)
        or (profile.network and profile.network != show.network)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The selected show delivery profile does not apply to this episode.",
        )
    manifest = (
        await session.execute(
            insert(episode_delivery_manifests)
            .values(
                organization_id=organization_id,
                episode_id=episode_id,
                delivery_profile_id=profile.id,
                profile_name=profile.name,
                specification_url=profile.specification_url,
                applied_by_user_id=actor_user_id,
                applied_at=datetime.now(UTC),
            )
            .returning(episode_delivery_manifests.c.id)
        )
    ).scalar_one()
    profile_items = (
        await session.execute(
            select(
                delivery_profile_items,
                crm_contacts.c.name.label("recipient_name"),
                crm_contacts.c.email.label("recipient_email"),
            )
            .outerjoin(
                crm_contacts,
                and_(
                    crm_contacts.c.id == delivery_profile_items.c.recipient_contact_id,
                    crm_contacts.c.organization_id == organization_id,
                ),
            )
            .where(
                and_(
                    delivery_profile_items.c.organization_id == organization_id,
                    delivery_profile_items.c.delivery_profile_id == profile.id,
                )
            )
            .order_by(delivery_profile_items.c.position)
        )
    ).all()
    if profile_items:
        await session.execute(
            insert(episode_delivery_items).values(
                [
                    {
                        "organization_id": organization_id,
                        "episode_delivery_manifest_id": manifest,
                        "episode_id": episode_id,
                        "delivery_profile_item_id": item.id,
                        "component_type": item.component_type,
                        "label": item.label,
                        "required": item.required,
                        "format_specification": item.format_specification,
                        "version": item.version,
                        "territory": item.territory,
                        "language": item.language,
                        "recipient_contact_id": item.recipient_contact_id,
                        "recipient_name": item.recipient_name,
                        "recipient_email": item.recipient_email,
                        "requires_external_recipient": item.requires_external_recipient,
                        "qc_required": item.qc_required,
                        "status": "not_started",
                        "due_date": (
                            delivery_deadline.date() + timedelta(days=item.default_deadline_offset_days or 0)
                            if delivery_deadline
                            else None
                        ),
                        "qc_result": "not_started" if item.qc_required else "not_required",
                        "position": item.position,
                    }
                    for item in profile_items
                ]
            )
        )
    await session.execute(
        insert(activity_log).values(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action="episode_delivery_manifest.generated",
            entity_type="episode_delivery_manifest",
            entity_id=str(manifest),
            metadata={
                "episodeId": episode_id,
                "deliveryProfileId": str(profile.id),
                "itemCount": len(profile_items),
            },
        )
    )


@router.get("")
async def list_episodes(
    actor: CurrentActor, session: DbSession, show_id: str | None = Query(default=None)
) -> dict[str, object]:
    return {"episodes": [_episode_response(row) for row in await _episode_rows(session, actor, show_id=show_id)]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_episode(payload: EpisodeCreateRequest, actor: CurrentActor, session: DbSession) -> dict[str, str]:
    await require_permission(session, actor, "manage_production")
    season = (
        await session.execute(
            select(
                seasons.c.id,
                shows.c.id.label("show_id"),
                shows.c.client_company_id,
                shows.c.network,
                shows.c.delivery_profile_id,
            )
            .join(shows, shows.c.id == seasons.c.show_id)
            .where(
                and_(
                    seasons.c.id == payload.season_id,
                    seasons.c.organization_id == actor.organization_id,
                    shows.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found.")

    person_ids = ids(
        [
            payload.assigned_producer_id,
            payload.editor_id,
            payload.colorist_id,
            payload.sound_mixer_id,
            *payload.team_ids,
        ]
    )
    if len(await _tenant_people(session, actor.organization_id, person_ids)) != len(person_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assigned person not found for this post house.",
        )

    first_stage = (
        await session.execute(
            select(workflow_stages.c.id)
            .join(post_workflows, post_workflows.c.id == workflow_stages.c.workflow_id)
            .where(
                and_(
                    workflow_stages.c.organization_id == actor.organization_id,
                    post_workflows.c.organization_id == actor.organization_id,
                    post_workflows.c.is_default.is_(True),
                )
            )
            .order_by(workflow_stages.c.position)
            .limit(1)
        )
    ).first()
    try:
        result = await session.execute(
            insert(episodes)
            .values(
                organization_id=actor.organization_id,
                season_id=payload.season_id,
                workflow_stage_id=first_stage.id if first_stage else None,
                workflow_status="not_started",
                assigned_producer_id=payload.assigned_producer_id,
                editor_id=payload.editor_id,
                colorist_id=payload.colorist_id,
                sound_mixer_id=payload.sound_mixer_id,
                number=payload.number,
                production_code=payload.production_code,
                title=payload.title.strip(),
                synopsis=payload.synopsis,
                # Legacy field only. It is retained for transition compatibility,
                # while workflow_status is the live product-facing state.
                status="development",
                qc_status="not_started",
                air_date=payload.air_date,
                locked_cut_date=payload.locked_cut_date,
                delivery_deadline=payload.delivery_deadline,
            )
            .returning(episodes.c.id)
        )
        episode_id = result.scalar_one()
        if payload.team_ids:
            await session.execute(
                pg_insert(episode_team_assignments)
                .values(
                    [
                        {
                            "organization_id": actor.organization_id,
                            "episode_id": episode_id,
                            "person_id": person_id,
                            "is_lead": False,
                        }
                        for person_id in ids(payload.team_ids)
                    ]
                )
                .on_conflict_do_nothing(index_elements=["episode_id", "person_id"])
            )
        await _create_delivery_manifest_for_new_episode(
            session,
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            episode_id=episode_id,
            show=season,
            delivery_deadline=payload.delivery_deadline,
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An episode with that number already exists in this season.",
        ) from error
    return {"id": episode_id}


@router.get("/{episode_id}")
async def get_episode(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_episode_access(session, actor, episode_id)
    rows = await _episode_rows(session, actor, episode_id=episode_id)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    episode = rows[0]
    team = (
        await session.execute(
            select(
                episode_team_assignments.c.id.label("assignment_id"),
                people.c.id.label("person_id"),
                people.c.name,
                people.c.role,
                episode_team_assignments.c.is_lead,
            )
            .join(people, people.c.id == episode_team_assignments.c.person_id)
            .where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    people.c.organization_id == actor.organization_id,
                )
            )
            .order_by(people.c.name)
        )
    ).all()
    return {
        "episode": _episode_response(episode),
        "team": [
            {
                "assignment_id": item.assignment_id,
                "person_id": item.person_id,
                "name": item.name,
                "role": item.role,
                "is_lead": item.is_lead,
            }
            for item in team
        ],
    }


@router.get("/{episode_id}/workspace")
async def get_episode_workspace(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """The tenant-scoped operational projection for the episode workspace.

    This replaces the previous Next server-data fan-out.  It intentionally
    makes one access decision before joining workflow, QC, scheduling,
    delivery, work-order and commercial records, so a changed route ID cannot
    expose another post house's episode data.
    """
    await require_episode_access(session, actor, episode_id)
    episode_rows = await _episode_rows(session, actor, episode_id=episode_id)
    if not episode_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    row = episode_rows[0]
    _, stages, rules, approvals = await _workflow_context(session, actor, episode_id)

    team_rows = (
        await session.execute(
            select(
                episode_team_assignments.c.id,
                episode_team_assignments.c.person_id,
                episode_team_assignments.c.is_lead,
                people.c.name,
                people.c.role,
            )
            .join(people, people.c.id == episode_team_assignments.c.person_id)
            .where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    people.c.organization_id == actor.organization_id,
                )
            )
            .order_by(people.c.name, people.c.id)
        )
    ).all()
    people_rows = (
        await session.execute(
            select(people.c.id, people.c.name, people.c.role)
            .where(and_(people.c.organization_id == actor.organization_id, people.c.is_active.is_(True)))
            .order_by(people.c.name, people.c.id)
        )
    ).all()
    exception_rows = (
        await session.execute(
            select(episode_workflow_exceptions)
            .where(
                and_(
                    episode_workflow_exceptions.c.organization_id == actor.organization_id,
                    episode_workflow_exceptions.c.episode_id == episode_id,
                    episode_workflow_exceptions.c.type == "early_start",
                )
            )
            .order_by(episode_workflow_exceptions.c.created_at, episode_workflow_exceptions.c.id)
        )
    ).all()

    schedule_rows = (
        await session.execute(
            select(bookings.c.id, bookings.c.title, bookings.c.starts_at, rooms.c.name.label("room_name"))
            .outerjoin(rooms, and_(rooms.c.id == bookings.c.room_id, rooms.c.organization_id == actor.organization_id))
            .where(and_(bookings.c.organization_id == actor.organization_id, bookings.c.episode_id == episode_id))
            .order_by(bookings.c.starts_at, bookings.c.id)
        )
    ).all()
    activity_rows = (
        await session.execute(
            select(
                activity_log.c.id,
                activity_log.c.action,
                activity_log.c.entity_type,
                activity_log.c.entity_id,
                activity_log.c.metadata,
                activity_log.c.created_at,
            )
            .where(
                and_(
                    activity_log.c.organization_id == actor.organization_id,
                    or_(
                        activity_log.c.entity_id == episode_id,
                        activity_log.c.metadata["episodeId"].as_string() == episode_id,
                    ),
                )
            )
            .order_by(activity_log.c.created_at.desc(), activity_log.c.id.desc())
            .limit(30)
        )
    ).all()
    qc_reports_rows = (
        await session.execute(
            select(qc_reports)
            .where(and_(qc_reports.c.organization_id == actor.organization_id, qc_reports.c.episode_id == episode_id))
            .order_by(qc_reports.c.created_at.desc(), qc_reports.c.id.desc())
        )
    ).all()
    qc_issue_rows = (
        await session.execute(
            select(qc_issues)
            .join(qc_reports, qc_reports.c.id == qc_issues.c.qc_report_id)
            .where(
                and_(
                    qc_issues.c.organization_id == actor.organization_id,
                    qc_reports.c.organization_id == actor.organization_id,
                    qc_reports.c.episode_id == episode_id,
                )
            )
            .order_by(qc_issues.c.created_at.desc(), qc_issues.c.id.desc())
        )
    ).all()

    can_view_commercial = await has_permission(session, actor, "manage_commercial") or bool(
        actor.active_organization and actor.active_organization.role == "client"
    )
    assignee = people.alias("workspace_work_order_assignee")
    approver = people.alias("workspace_work_order_approver")
    work_order_rows = (
        await session.execute(
            select(
                post_work_orders,
                workflow_stages.c.name.label("workflow_stage_name"),
                assignee.c.name.label("assignee_name"),
                assignee.c.role.label("assignee_role_name"),
                approver.c.name.label("approved_by_name"),
                purchase_orders.c.po_number.label("purchase_order_number"),
                budget_lines.c.category.label("budget_item_category"),
                budget_lines.c.description.label("budget_item_description"),
                budget_lines.c.budgeted_amount.label("budget_item_estimated_amount"),
                budget_lines.c.actual_amount.label("budget_item_actual_amount"),
                budget_lines.c.currency.label("budget_item_currency"),
            )
            .outerjoin(
                workflow_stages,
                and_(
                    workflow_stages.c.id == post_work_orders.c.workflow_stage_id,
                    workflow_stages.c.organization_id == actor.organization_id,
                ),
            )
            .outerjoin(
                assignee,
                and_(
                    assignee.c.id == post_work_orders.c.assignee_person_id,
                    assignee.c.organization_id == actor.organization_id,
                ),
            )
            .outerjoin(
                approver,
                and_(
                    approver.c.id == post_work_orders.c.approved_by_person_id,
                    approver.c.organization_id == actor.organization_id,
                ),
            )
            .outerjoin(
                purchase_orders,
                and_(
                    purchase_orders.c.id == post_work_orders.c.purchase_order_id,
                    purchase_orders.c.organization_id == actor.organization_id,
                ),
            )
            .outerjoin(
                budget_lines,
                and_(
                    budget_lines.c.id == post_work_orders.c.budget_line_id,
                    budget_lines.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    post_work_orders.c.organization_id == actor.organization_id,
                    post_work_orders.c.episode_id == episode_id,
                )
            )
            .order_by(post_work_orders.c.due_at.asc().nulls_last(), post_work_orders.c.created_at.desc())
        )
    ).all()
    work_order_ids = [item.id for item in work_order_rows]
    item_rows = (
        await session.execute(
            select(post_work_order_items)
            .where(
                and_(
                    post_work_order_items.c.organization_id == actor.organization_id,
                    post_work_order_items.c.work_order_id.in_(work_order_ids) if work_order_ids else False,
                )
            )
            .order_by(post_work_order_items.c.position, post_work_order_items.c.id)
        )
    ).all()
    items_by_work_order: dict[str, list[object]] = {}
    for item in item_rows:
        items_by_work_order.setdefault(str(item.work_order_id), []).append(item)

    current_stage = next((stage for stage in stages if stage.id == row.workflow_stage_id), None)
    blocker = await _stage_blocker(session, actor, episode_id, current_stage) if current_stage else None
    budget_rows = []
    if can_view_commercial:
        budget_rows = (
            await session.execute(
                select(
                    budget_lines.c.id,
                    budget_lines.c.category,
                    budget_lines.c.description,
                    budget_lines.c.budgeted_amount,
                    budget_lines.c.actual_amount,
                )
                .where(
                    and_(
                        budget_lines.c.organization_id == actor.organization_id,
                        budget_lines.c.episode_id == episode_id,
                    )
                )
                .order_by(budget_lines.c.category, budget_lines.c.created_at, budget_lines.c.id)
            )
        ).all()
    vendor_rows = (
        await session.execute(
            select(crm_companies.c.id, crm_companies.c.name)
            .where(and_(crm_companies.c.organization_id == actor.organization_id, crm_companies.c.type == "vendor"))
            .order_by(crm_companies.c.name, crm_companies.c.id)
        )
    ).all()
    from app.api.routes.deliveries import _manifest_response

    try:
        manifest = await _manifest_response(session, actor.organization_id, episode_id)
    except HTTPException as error:
        if error.status_code != status.HTTP_404_NOT_FOUND:
            raise
        manifest = None
    profiles = (
        await session.execute(
            select(delivery_profiles.c.id, delivery_profiles.c.name)
            .where(
                and_(
                    delivery_profiles.c.organization_id == actor.organization_id,
                    delivery_profiles.c.is_active.is_(True),
                )
            )
            .order_by(delivery_profiles.c.name, delivery_profiles.c.id)
        )
    ).all()

    return {
        "episode": {
            **_episode_response(row),
            "status": row.workflow_status,
            "workflow_state": {
                "display_status": row.workflow_status,
                "label": workflow_projection(row)["workflow_label"],
                "primary_stage_id": str(row.workflow_stage_id) if row.workflow_stage_id else None,
                "primary_stage_name": row.workflow_stage_name,
            },
        },
        "schedule": [
            {"id": str(item.id), "title": item.title, "starts_at": item.starts_at, "room_name": item.room_name}
            for item in schedule_rows
        ],
        "budget": [
            {
                "id": str(item.id),
                "category": item.category,
                "description": item.description,
                "budgeted_amount": str(item.budgeted_amount),
                "actual_amount": str(item.actual_amount),
            }
            for item in budget_rows
        ],
        "activity": [
            {
                "id": str(item.id),
                "action": item.action,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "metadata": item.metadata,
                "created_at": item.created_at,
            }
            for item in activity_rows
        ],
        "workflow_stages": [
            {
                "id": str(item.id),
                "name": item.name,
                "key": item.key,
                "position": item.position,
                "is_terminal": item.is_terminal,
                "can_start_early": item.can_start_early,
                "requires_qc_pass": item.requires_qc_pass,
                "delivery_gate": item.delivery_gate,
            }
            for item in stages
        ],
        "workflow_approval_rules": [
            {
                "id": str(item.id),
                "workflow_stage_id": str(item.workflow_stage_id),
                "approver_role": item.approver_role,
                "label": item.label,
                "approval_order": item.approval_order,
                "is_required": item.is_required,
            }
            for item in rules
        ],
        "workflow_approvals": [
            {
                "id": str(item.id),
                "workflow_stage_id": str(item.workflow_stage_id),
                "approval_rule_id": str(item.approval_rule_id),
                "approver_role": item.approver_role,
                "required_person_id": str(item.required_person_id) if item.required_person_id else None,
                "status": item.status,
                "comment": item.comment,
                "submitted_at": item.submitted_at,
                "responded_at": item.responded_at,
            }
            for item in approvals
        ],
        "workflow_exceptions": [
            {
                "id": str(item.id),
                "workflow_stage_id": str(item.workflow_stage_id),
                "type": item.type,
                "reason": item.reason,
                "created_at": item.created_at,
            }
            for item in exception_rows
        ],
        "workflow_operational_blockers": (
            [
                {
                    "kind": (
                        "work_order"
                        if blocker.startswith("Blocking work order")
                        else "qc"
                        if "QC" in blocker
                        else "delivery"
                    ),
                    "message": blocker,
                }
            ]
            if blocker
            else []
        ),
        "workflow_approvers": [{"id": str(item.id), "name": item.name, "role": item.role} for item in people_rows],
        # A signer is nominated once per episode-team role.  The stage rule
        # determines which role is eligible; the checked team member supplies
        # the named person for every matching rule.
        "workflow_signers": [
            {
                "approval_rule_id": str(rule.id),
                "person_id": str(member.person_id),
                "name": member.name,
                "role": member.role,
            }
            for rule in rules
            if rule.approver_role
            for member in team_rows
            if member.is_lead and member.role == rule.approver_role
        ],
        "episode_team": [
            {
                "id": str(item.id),
                "person_id": str(item.person_id),
                "name": item.name,
                "role": item.role,
                "is_lead": item.is_lead,
            }
            for item in team_rows
        ],
        "work_orders": [
            {
                "id": str(item.id),
                "workflow_stage_id": str(item.workflow_stage_id) if item.workflow_stage_id else None,
                "workflow_stage_name": item.workflow_stage_name,
                "kind": item.kind,
                "title": item.title,
                "description": item.description,
                "department": item.department,
                "assignee_person_id": str(item.assignee_person_id) if item.assignee_person_id else None,
                "assignee_name": item.assignee_name,
                "assignee_role": item.assignee_role_name or item.assignee_role,
                "work_type": item.work_type,
                "vendor_company_id": str(item.vendor_company_id) if item.vendor_company_id else None,
                "purchase_order_id": str(item.purchase_order_id) if item.purchase_order_id else None,
                "purchase_order_number": item.purchase_order_number,
                "client_purchase_order_id": (
                    str(item.client_purchase_order_id) if item.client_purchase_order_id else None
                ),
                "priority": item.priority,
                "is_blocking": item.is_blocking,
                "status": item.status,
                "billing_scope": item.billing_scope,
                "billing_status": item.billing_status,
                "commercial_treatment": item.commercial_treatment,
                "planned_duration_quantity": str(item.planned_duration_quantity)
                if item.planned_duration_quantity is not None
                else None,
                "planned_duration_unit": item.planned_duration_unit,
                "standard_day_hours_snapshot": str(item.standard_day_hours_snapshot)
                if item.standard_day_hours_snapshot is not None
                else None,
                "allow_overtime_billing": item.allow_overtime_billing,
                "overtime_multiplier": str(item.overtime_multiplier) if item.overtime_multiplier is not None else None,
                "overtime_hourly_base_rate": str(item.overtime_hourly_base_rate)
                if item.overtime_hourly_base_rate is not None
                else None,
                "estimated_amount": str(item.estimated_amount) if item.estimated_amount is not None else None,
                "client_quote_amount": str(item.client_quote_amount) if item.client_quote_amount is not None else None,
                "actual_amount": str(item.actual_amount) if item.actual_amount is not None else None,
                "currency": item.currency,
                "client_quote_currency": item.client_quote_currency,
                "billing_notes": item.billing_notes,
                "budget_line_id": str(item.budget_line_id) if item.budget_line_id else None,
                "budget_item": {
                    "id": str(item.budget_line_id),
                    "label": item.budget_item_description or item.budget_item_category,
                }
                if item.budget_line_id and (item.budget_item_description or item.budget_item_category)
                else None,
                "budget_item_context": {
                    "estimated_amount": str(item.budget_item_estimated_amount),
                    "actual_amount": str(item.budget_item_actual_amount),
                    "remaining_estimate": str(
                        max(0, item.budget_item_estimated_amount - item.budget_item_actual_amount)
                    ),
                    "currency": item.budget_item_currency,
                }
                if can_view_commercial and item.budget_line_id and item.budget_item_estimated_amount is not None
                else None,
                "approved_by_person_id": str(item.approved_by_person_id) if item.approved_by_person_id else None,
                "approved_by_name": item.approved_by_name,
                "approved_at": item.approved_at,
                "approval_note": item.approval_note,
                "external_url": item.external_url,
                "due_at": item.due_at,
                "completed_at": item.completed_at,
                "items": [
                    {
                        "id": str(child.id),
                        "type": child.type,
                        "description": child.description,
                        "quantity": str(child.quantity),
                        "unit": child.unit,
                        "unit_rate": str(child.unit_rate),
                        "discount_percent": str(child.discount_percent),
                        "notes": child.notes,
                        "position": child.position,
                    }
                    for child in items_by_work_order.get(str(item.id), [])
                ],
            }
            for item in work_order_rows
        ],
        "qc_history": [
            {
                "id": str(item.id),
                "status": item.status,
                "report_url": item.report_url,
                "summary": item.summary,
                "waiver_reason": item.waiver_reason,
                "completed_at": item.completed_at,
                "created_at": item.created_at,
            }
            for item in qc_reports_rows
        ],
        "qc_issue_history": [
            {
                "id": str(item.id),
                "qc_report_id": str(item.qc_report_id),
                "code": item.code,
                "severity": item.severity,
                "description": item.description,
                "timecode_seconds": str(item.timecode_seconds) if item.timecode_seconds is not None else None,
                "status": item.status,
                "resolution": item.resolution,
                "resolved_at": item.resolved_at,
                "created_at": item.created_at,
            }
            for item in qc_issue_rows
        ],
        "vendor_options": [{"id": str(item.id), "name": item.name} for item in vendor_rows],
        "delivery_manifest": manifest,
        "delivery_profiles": [{"id": str(item.id), "name": item.name} for item in profiles],
    }


@router.get("/{episode_id}/access")
async def episode_access(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, bool]:
    """Validate an assignment against the active tenant's episode team."""
    await require_episode_access(session, actor, episode_id)
    return {"assigned": await _is_episode_member(session, actor, episode_id)}


@router.patch("/{episode_id}")
async def update_episode(
    episode_id: str, payload: EpisodeUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, str]:
    await require_permission(session, actor, "manage_production")
    await require_episode_access(session, actor, episode_id)
    values = payload.model_dump(exclude_unset=True)
    if "title" in values and values["title"] is not None:
        values["title"] = values["title"].strip()
    if not values:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide at least one episode change.",
        )
    values["updated_at"] = datetime.now(UTC)
    result = await session.execute(
        update(episodes)
        .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
        .values(**values)
        .returning(episodes.c.id)
    )
    await session.commit()
    if not result.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    return {"id": episode_id}


@router.get("/{episode_id}/team")
async def get_episode_team(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return the editable team and workflow roles eligible for signer nomination."""
    await require_permission(session, actor, "manage_production")
    await require_episode_access(session, actor, episode_id)
    assignments = (
        await session.execute(
            select(
                episode_team_assignments.c.id,
                episode_team_assignments.c.person_id,
                people.c.name,
                people.c.role,
                episode_team_assignments.c.is_lead,
            )
            .join(people, people.c.id == episode_team_assignments.c.person_id)
            .where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    people.c.organization_id == actor.organization_id,
                )
            )
            .order_by(people.c.name, people.c.id)
        )
    ).all()
    tenant_people = (
        await session.execute(
            select(people.c.id, people.c.name, people.c.role)
            .where(and_(people.c.organization_id == actor.organization_id, people.c.is_active.is_(True)))
            .order_by(people.c.name, people.c.id)
        )
    ).all()
    eligible_roles = (
        await session.execute(
            select(
                workflow_stage_approval_rules.c.approver_role,
            )
            .join(workflow_stages, workflow_stages.c.id == workflow_stage_approval_rules.c.workflow_stage_id)
            .join(post_workflows, post_workflows.c.id == workflow_stages.c.workflow_id)
            .where(
                and_(
                    workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                    workflow_stages.c.organization_id == actor.organization_id,
                    post_workflows.c.organization_id == actor.organization_id,
                    post_workflows.c.is_default.is_(True),
                    workflow_stage_approval_rules.c.approver_role.is_not(None),
                )
            )
            .distinct()
            .order_by(workflow_stage_approval_rules.c.approver_role)
        )
    ).all()
    return {
        "assignments": [
            {
                "id": str(item.id),
                "person_id": str(item.person_id),
                "name": item.name,
                "role": item.role,
                "is_lead": item.is_lead,
            }
            for item in assignments
        ],
        "people": [{"id": str(item.id), "name": item.name, "role": item.role} for item in tenant_people],
        "eligible_signer_roles": [item.approver_role for item in eligible_roles if item.approver_role],
    }


@router.post("/{episode_id}/team", status_code=status.HTTP_201_CREATED)
async def add_episode_team_member(
    episode_id: str, payload: EpisodeTeamAddRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_production")
    await require_episode_access(session, actor, episode_id)
    if payload.person_id not in await _tenant_people(session, actor.organization_id, [payload.person_id]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found.")
    result = await session.execute(
        pg_insert(episode_team_assignments)
        .values(
            organization_id=actor.organization_id,
            episode_id=episode_id,
            person_id=payload.person_id,
            is_lead=False,
        )
        .on_conflict_do_nothing(index_elements=["episode_id", "person_id"])
        .returning(episode_team_assignments.c.id)
    )
    await session.commit()
    assignment_id = result.scalar_one_or_none()
    return {"id": assignment_id, "duplicate": assignment_id is None}


@router.patch("/{episode_id}/team")
async def set_episode_team_signer(
    episode_id: str, payload: EpisodeTeamSignerRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Nominate one matching-role episode-team member as the workflow signer."""
    await require_permission(session, actor, "manage_production")
    await require_episode_access(session, actor, episode_id)
    assignment = (
        await session.execute(
            select(episode_team_assignments.c.id, episode_team_assignments.c.person_id, people.c.role)
            .join(people, people.c.id == episode_team_assignments.c.person_id)
            .where(
                and_(
                    episode_team_assignments.c.id == payload.assignment_id,
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    people.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode-team assignment not found.")
    eligible = (
        await session.execute(
            select(workflow_stage_approval_rules.c.id)
            .join(workflow_stages, workflow_stages.c.id == workflow_stage_approval_rules.c.workflow_stage_id)
            .join(post_workflows, post_workflows.c.id == workflow_stages.c.workflow_id)
            .where(
                and_(
                    workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                    workflow_stage_approval_rules.c.approver_role == assignment.role,
                    workflow_stages.c.organization_id == actor.organization_id,
                    post_workflows.c.organization_id == actor.organization_id,
                    post_workflows.c.is_default.is_(True),
                )
            )
            .limit(1)
        )
    ).first()
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This person’s role is not configured for workflow sign-off.",
        )
    # One checked workflow signer per occupational role.  The same person can
    # sign stages of that role throughout this episode, while all other people
    # remain ordinary episode-team members.
    if payload.is_signer:
        await session.execute(
            update(episode_team_assignments)
            .where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    episode_team_assignments.c.person_id.in_(
                        select(people.c.id).where(
                            and_(people.c.organization_id == actor.organization_id, people.c.role == assignment.role)
                        )
                    ),
                )
            )
            .values(is_lead=False)
        )
    await session.execute(
        update(episode_team_assignments)
        .where(
            and_(
                episode_team_assignments.c.id == payload.assignment_id,
                episode_team_assignments.c.organization_id == actor.organization_id,
                episode_team_assignments.c.episode_id == episode_id,
            )
        )
        .values(is_lead=payload.is_signer)
    )
    # Pending approvals are reassigned only within this role.  Completed
    # approvals retain their historical named signer.
    role_rule_ids = (
        select(workflow_stage_approval_rules.c.id)
        .join(workflow_stages, workflow_stages.c.id == workflow_stage_approval_rules.c.workflow_stage_id)
        .join(post_workflows, post_workflows.c.id == workflow_stages.c.workflow_id)
        .where(
            and_(
                workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                workflow_stage_approval_rules.c.approver_role == assignment.role,
                workflow_stages.c.organization_id == actor.organization_id,
                post_workflows.c.organization_id == actor.organization_id,
                post_workflows.c.is_default.is_(True),
            )
        )
    )
    pending = and_(
        episode_workflow_approvals.c.organization_id == actor.organization_id,
        episode_workflow_approvals.c.episode_id == episode_id,
        episode_workflow_approvals.c.approval_rule_id.in_(role_rule_ids),
        episode_workflow_approvals.c.status == "pending",
    )
    if payload.is_signer:
        await session.execute(
            update(episode_workflow_approvals)
            .where(pending)
            .values(
                approver_role=assignment.role,
                required_person_id=assignment.person_id,
                updated_at=datetime.now(UTC),
            )
        )
    else:
        await session.execute(
            update(episode_workflow_approvals)
            .where(and_(pending, episode_workflow_approvals.c.required_person_id == assignment.person_id))
            .values(required_person_id=None, updated_at=datetime.now(UTC))
        )
    await session.commit()
    return {"ok": True, "is_signer": payload.is_signer}


@router.delete("/{episode_id}/team/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_episode_team_member(
    episode_id: str, assignment_id: str, actor: CurrentActor, session: DbSession
) -> None:
    await require_permission(session, actor, "manage_production")
    await require_episode_access(session, actor, episode_id)
    assignment = (
        await session.execute(
            select(episode_team_assignments.c.person_id)
            .where(
                and_(
                    episode_team_assignments.c.id == assignment_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    episode_team_assignments.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode-team assignment not found.")
    pending_signer = (
        await session.execute(
            select(episode_workflow_approvals.c.id)
            .where(
                and_(
                    episode_workflow_approvals.c.organization_id == actor.organization_id,
                    episode_workflow_approvals.c.episode_id == episode_id,
                    episode_workflow_approvals.c.required_person_id == assignment.person_id,
                    episode_workflow_approvals.c.status == "pending",
                )
            )
            .limit(1)
        )
    ).first()
    if pending_signer:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Choose a replacement sign-off person before removing this episode-team member.",
        )
    result = await session.execute(
        delete(episode_team_assignments).where(
            and_(
                episode_team_assignments.c.id == assignment_id,
                episode_team_assignments.c.episode_id == episode_id,
                episode_team_assignments.c.organization_id == actor.organization_id,
            )
        )
    )
    await session.commit()
    if not result.rowcount:  # defensive race guard
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode-team assignment not found.")


async def _workflow_context(
    session: DbSession, actor: CurrentActor, episode_id: str
) -> tuple[object, list[object], list[object], list[object]]:
    episode = (
        await session.execute(
            select(episodes.c.id, episodes.c.workflow_stage_id, episodes.c.workflow_status)
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    stages = (
        await session.execute(
            select(workflow_stages)
            .join(post_workflows, post_workflows.c.id == workflow_stages.c.workflow_id)
            .where(
                and_(
                    workflow_stages.c.organization_id == actor.organization_id,
                    post_workflows.c.organization_id == actor.organization_id,
                    post_workflows.c.is_default.is_(True),
                )
            )
            .order_by(workflow_stages.c.position)
        )
    ).all()
    stage_ids = [stage.id for stage in stages]
    rules = []
    approvals = []
    if stage_ids:
        rules = (
            await session.execute(
                select(workflow_stage_approval_rules)
                .where(
                    and_(
                        workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                        workflow_stage_approval_rules.c.workflow_stage_id.in_(stage_ids),
                    )
                )
                .order_by(workflow_stage_approval_rules.c.approval_order)
            )
        ).all()
        approvals = (
            await session.execute(
                select(episode_workflow_approvals).where(
                    and_(
                        episode_workflow_approvals.c.organization_id == actor.organization_id,
                        episode_workflow_approvals.c.episode_id == episode_id,
                    )
                )
            )
        ).all()
    return episode, stages, rules, approvals


async def _is_episode_member(session: DbSession, actor: CurrentActor, episode_id: str) -> bool:
    if not actor.person_id:
        return False
    return bool(
        (
            await session.execute(
                select(episodes.c.id)
                .outerjoin(
                    episode_team_assignments,
                    and_(
                        episode_team_assignments.c.organization_id == actor.organization_id,
                        episode_team_assignments.c.episode_id == episodes.c.id,
                    ),
                )
                .where(
                    and_(
                        episodes.c.id == episode_id,
                        episodes.c.organization_id == actor.organization_id,
                        or_(
                            episodes.c.assigned_producer_id == actor.person_id,
                            episodes.c.editor_id == actor.person_id,
                            episodes.c.colorist_id == actor.person_id,
                            episodes.c.sound_mixer_id == actor.person_id,
                            episode_team_assignments.c.person_id == actor.person_id,
                        ),
                    )
                )
                .limit(1)
            )
        ).first()
    )


async def _stage_blocker(session: DbSession, actor: CurrentActor, episode_id: str, stage: object) -> str | None:
    """Keep the three real operational gates concise and server-enforced."""
    if stage.requires_qc_pass:
        qc = (
            await session.execute(
                select(qc_reports.c.status)
                .where(
                    and_(qc_reports.c.organization_id == actor.organization_id, qc_reports.c.episode_id == episode_id)
                )
                .order_by(qc_reports.c.created_at.desc(), qc_reports.c.id.desc())
                .limit(1)
            )
        ).first()
        if not qc or qc.status not in {"passed", "waived"}:
            return "A passed or authorised-waived QC report is required before this stage can be signed off."
    if stage.delivery_gate != "none":
        has_local_acceptance_exception = False
        if stage.delivery_gate == "client_acceptance":
            has_local_acceptance_exception = bool(
                (
                    await session.execute(
                        select(episode_delivery_acceptance_exceptions.c.id)
                        .where(
                            and_(
                                episode_delivery_acceptance_exceptions.c.organization_id == actor.organization_id,
                                episode_delivery_acceptance_exceptions.c.episode_id == episode_id,
                                episode_delivery_acceptance_exceptions.c.workflow_stage_id == stage.id,
                            )
                        )
                        .limit(1)
                    )
                ).first()
            )
        requirement = (
            "dispatched"
            if stage.delivery_gate == "facility_dispatch" or has_local_acceptance_exception
            else "receipt_confirmed"
        )
        outstanding = (
            await session.execute(
                select(episode_delivery_items.c.id)
                .where(
                    and_(
                        episode_delivery_items.c.organization_id == actor.organization_id,
                        episode_delivery_items.c.episode_id == episode_id,
                        episode_delivery_items.c.required.is_(True),
                        episode_delivery_items.c.status.not_in((requirement, "waived")),
                    )
                )
                .limit(1)
            )
        ).first()
        if outstanding:
            return (
                "Every required delivery item must be receipt-confirmed before sign-off."
                if requirement == "receipt_confirmed"
                else "Every required delivery item must be dispatched before sign-off."
            )
    work_order = (
        await session.execute(
            select(post_work_orders.c.title)
            .where(
                and_(
                    post_work_orders.c.organization_id == actor.organization_id,
                    post_work_orders.c.episode_id == episode_id,
                    post_work_orders.c.workflow_stage_id == stage.id,
                    post_work_orders.c.is_blocking.is_(True),
                    post_work_orders.c.status.not_in(("complete", "cancelled")),
                )
            )
            .limit(1)
        )
    ).first()
    if work_order:
        return f"Blocking work order: {work_order.title}. Complete or cancel it before signing off."
    return None


async def _create_stage_work_orders(session: DbSession, actor: CurrentActor, episode_id: str, stage_id: str) -> None:
    templates = (
        await session.execute(
            select(workflow_stage_work_order_templates)
            .where(
                and_(
                    workflow_stage_work_order_templates.c.organization_id == actor.organization_id,
                    workflow_stage_work_order_templates.c.workflow_stage_id == stage_id,
                )
            )
            .order_by(workflow_stage_work_order_templates.c.position)
        )
    ).all()
    for template in templates:
        exists = (
            await session.execute(
                select(post_work_orders.c.id)
                .where(
                    and_(
                        post_work_orders.c.organization_id == actor.organization_id,
                        post_work_orders.c.episode_id == episode_id,
                        post_work_orders.c.workflow_stage_id == stage_id,
                        post_work_orders.c.title == template.title,
                    )
                )
                .limit(1)
            )
        ).first()
        if not exists:
            await session.execute(
                insert(post_work_orders).values(
                    organization_id=actor.organization_id,
                    episode_id=episode_id,
                    workflow_stage_id=stage_id,
                    work_type="internal",
                    kind="work_order",
                    title=template.title,
                    description=template.description,
                    department=template.department,
                    assignee_role=template.assignee_role,
                    priority=template.priority,
                    is_blocking=template.is_blocking,
                    status="open",
                    billing_scope="included",
                    billing_status="not_billable",
                    # A generated operational work order starts from the
                    # ordinary room-and-operator commercial structure. The
                    # later booking or a commercial manager may set a
                    # different treatment before it is approved.
                    commercial_treatment="wet_hire",
                    currency=actor.active_organization.currency,
                    created_by_user_id=actor.user_id,
                )
            )


@router.post("/{episode_id}")
async def transition_episode_workflow(
    episode_id: str, payload: WorkflowActionRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Perform the single-current-stage workflow lifecycle.

    It deliberately contains no role names: tenant-configured sign-off roles,
    nominated episode-team people, and policy capabilities govern every action.
    """
    await require_episode_access(session, actor, episode_id)
    episode, stages, rules, approvals = await _workflow_context(session, actor, episode_id)
    stage = next((item for item in stages if str(item.id) == payload.workflow_stage_id), None)
    if not stage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow stage not found.")
    member = await _is_episode_member(session, actor, episode_id)
    may_manage = await has_permission(session, actor, "manage_workflow_stages")
    may_update = may_manage or (member and await has_permission(session, actor, "update_assigned_workflow_work"))
    may_submit = member and await has_permission(session, actor, "submit_workflow_stages")
    may_sign = member and await has_permission(session, actor, "sign_off_workflow_stages")

    if payload.action == "start_early":
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Explain why this stage is starting early.",
            )
        current = next((item for item in stages if item.id == episode.workflow_stage_id), None)
        if not current or stage.position <= current.position:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Choose a future workflow stage to start early."
            )
        if not stage.can_start_early:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This stage is not configured to start early."
            )
        await require_permission(session, actor, "authorize_early_starts")
        existing = (
            await session.execute(
                select(episode_workflow_exceptions.c.id)
                .where(
                    and_(
                        episode_workflow_exceptions.c.organization_id == actor.organization_id,
                        episode_workflow_exceptions.c.episode_id == episode_id,
                        episode_workflow_exceptions.c.workflow_stage_id == stage.id,
                        episode_workflow_exceptions.c.type == "early_start",
                    )
                )
                .limit(1)
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This early start has already been recorded."
            )
        await session.execute(
            insert(episode_workflow_exceptions).values(
                organization_id=actor.organization_id,
                episode_id=episode_id,
                workflow_stage_id=stage.id,
                type="early_start",
                reason=payload.reason,
                authorized_by_user_id=actor.user_id,
            )
        )
        await _create_stage_work_orders(session, actor, episode_id, str(stage.id))
        await _audit_workflow(session, actor, episode_id, "workflow.stage_started_early", stage.name, payload.reason)
        await session.commit()
        return {"ok": True, "action": payload.action, "early_stage_id": str(stage.id)}

    if episode.workflow_stage_id != stage.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only the episode's current workflow stage can be updated."
        )
    if payload.action in {"start", "block", "resume"} and not may_update:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to update this workflow stage."
        )
    if payload.action == "start":
        if episode.workflow_status != "not_started":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This workflow stage is already active or complete."
            )
        await session.execute(
            update(episodes)
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .values(workflow_status="in_progress", updated_at=datetime.now(UTC))
        )
        await _create_stage_work_orders(session, actor, episode_id, str(stage.id))
        await _audit_workflow(session, actor, episode_id, "workflow.stage_started", stage.name)
    elif payload.action == "block":
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Explain why this workflow stage is blocked.",
            )
        if episode.workflow_status not in {"in_progress", "awaiting_sign_off"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an active stage can be blocked.")
        await session.execute(
            update(episodes)
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .values(workflow_status="blocked", updated_at=datetime.now(UTC))
        )
        await _audit_workflow(session, actor, episode_id, "workflow.stage_blocked", stage.name, payload.reason)
    elif payload.action == "resume":
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Add a short note before resuming a blocked workflow stage.",
            )
        if episode.workflow_status != "blocked":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This workflow stage is not blocked.")
        pending = any(approval.workflow_stage_id == stage.id and approval.status == "pending" for approval in approvals)
        await session.execute(
            update(episodes)
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .values(workflow_status="awaiting_sign_off" if pending else "in_progress", updated_at=datetime.now(UTC))
        )
        await _audit_workflow(session, actor, episode_id, "workflow.stage_resumed", stage.name, payload.reason)
    elif payload.action == "submit":
        if not may_submit:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to submit this workflow stage.",
            )
        if episode.workflow_status != "in_progress":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Only an in-progress stage can be submitted for sign-off."
            )
        stage_rules = [rule for rule in rules if rule.workflow_stage_id == stage.id and rule.is_required]
        if not stage_rules:
            blocker = await _stage_blocker(session, actor, episode_id, stage)
            if blocker:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=blocker)
            await _complete_stage(session, actor, episode_id, stage, stages)
        else:
            signers = (
                await session.execute(
                    select(people.c.role, people.c.id.label("person_id"))
                    .select_from(episode_team_assignments)
                    .join(people, people.c.id == episode_team_assignments.c.person_id)
                    .where(
                        and_(
                            episode_team_assignments.c.organization_id == actor.organization_id,
                            episode_team_assignments.c.episode_id == episode_id,
                            episode_team_assignments.c.is_lead.is_(True),
                            people.c.organization_id == actor.organization_id,
                        )
                    )
                )
            ).all()
            signer_by_role = {item.role: item.person_id for item in signers}
            missing = [
                rule for rule in stage_rules if not rule.approver_role or rule.approver_role not in signer_by_role
            ]
            if missing:
                missing_roles = ", ".join(
                    sorted({(rule.approver_role or "unconfigured role").replace("_", " ") for rule in missing})
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Mark an episode-team workflow signer for: "
                        f"{missing_roles}. The selected person must have the role configured on this stage."
                    ),
                )
            for rule in stage_rules:
                await session.execute(
                    pg_insert(episode_workflow_approvals)
                    .values(
                        organization_id=actor.organization_id,
                        episode_id=episode_id,
                        workflow_stage_id=stage.id,
                        approval_rule_id=rule.id,
                        approver_role=rule.approver_role,
                        required_person_id=signer_by_role[rule.approver_role],
                        status="pending",
                    )
                    .on_conflict_do_nothing(index_elements=["episode_id", "approval_rule_id"])
                )
            await session.execute(
                update(episodes)
                .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
                .values(workflow_status="awaiting_sign_off", updated_at=datetime.now(UTC))
            )
            await _audit_workflow(session, actor, episode_id, "workflow.stage_submitted", stage.name)
    elif payload.action == "sign_off":
        if not may_sign:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to sign off this workflow stage.",
            )
        if episode.workflow_status != "awaiting_sign_off":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Submit this workflow stage before recording a sign-off."
            )
        stage_rules = [rule for rule in rules if rule.workflow_stage_id == stage.id]
        target = next((rule for rule in stage_rules if str(rule.id) == payload.approval_rule_id), None)
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow sign-off slot not found.")
        prior_pending = any(
            rule.is_required
            and rule.approval_order < target.approval_order
            and not any(
                approval.approval_rule_id == rule.id and approval.status == "approved" for approval in approvals
            )
            for rule in stage_rules
        )
        if prior_pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Complete the earlier required sign-offs first."
            )
        approval = next((item for item in approvals if item.approval_rule_id == target.id), None)
        if not approval or approval.status != "pending":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This sign-off is no longer pending.")
        if approval.required_person_id != actor.person_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This sign-off is assigned to another episode-team member.",
            )
        blocker = await _stage_blocker(session, actor, episode_id, stage)
        if blocker:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=blocker)
        await session.execute(
            update(episode_workflow_approvals)
            .where(
                and_(
                    episode_workflow_approvals.c.id == approval.id,
                    episode_workflow_approvals.c.organization_id == actor.organization_id,
                    episode_workflow_approvals.c.status == "pending",
                )
            )
            .values(
                status="approved",
                approver_person_id=actor.person_id,
                comment=payload.comment,
                responded_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        await _audit_workflow(session, actor, episode_id, "workflow.signed_off", stage.name, payload.comment)
        refreshed = (
            await session.execute(
                select(episode_workflow_approvals).where(
                    and_(
                        episode_workflow_approvals.c.organization_id == actor.organization_id,
                        episode_workflow_approvals.c.episode_id == episode_id,
                        episode_workflow_approvals.c.workflow_stage_id == stage.id,
                    )
                )
            )
        ).all()
        pending_required = any(
            rule.is_required
            and not any(item.approval_rule_id == rule.id and item.status == "approved" for item in refreshed)
            for rule in stage_rules
        )
        if not pending_required:
            await _complete_stage(session, actor, episode_id, stage, stages)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported workflow action.")
    await session.commit()
    return {"ok": True, "action": payload.action}


async def _audit_workflow(
    session: DbSession, actor: CurrentActor, episode_id: str, action: str, stage_name: str, reason: str | None = None
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type="episode",
            entity_id=episode_id,
            metadata={"stage": stage_name, "reason": reason} if reason else {"stage": stage_name},
        )
    )


async def _complete_stage(
    session: DbSession, actor: CurrentActor, episode_id: str, stage: object, stages: list[object]
) -> None:
    next_stage = next((item for item in stages if item.position > stage.position), None)
    await session.execute(
        update(episodes)
        .where(
            and_(
                episodes.c.id == episode_id,
                episodes.c.organization_id == actor.organization_id,
                episodes.c.workflow_stage_id == stage.id,
            )
        )
        .values(
            workflow_stage_id=next_stage.id if next_stage else stage.id,
            workflow_status="not_started" if next_stage else "complete",
            updated_at=datetime.now(UTC),
        )
    )
    await _audit_workflow(session, actor, episode_id, "workflow.stage_completed", stage.name)
