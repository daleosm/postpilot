"""Tenant-scoped delivery profile and manifest APIs.

Profiles are reusable requirements. Applying one copies a point-in-time
manifest to an episode; later profile edits therefore never rewrite a delivery
record that has already been agreed with a client or network.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, delete, exists, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import assigned_episode_condition, may_view_all_episodes
from app.api.schemas import (
    ApplyDeliveryProfileRequest,
    DeliveryAcceptanceExceptionRequest,
    DeliveryItemTransitionRequest,
    DeliveryManifestShareRequest,
    DeliveryProfileCreateRequest,
    DeliveryProfileItemCreateRequest,
    DeliveryProfileItemUpdateRequest,
    DeliveryProfileUpdateRequest,
    EpisodeDeliveryItemCreateRequest,
    EpisodeDeliveryItemRemoveRequest,
    EpisodeDeliveryItemUpdateRequest,
)
from app.auth import has_permission, require_permission
from app.db.tables import (
    activity_log,
    crm_companies,
    crm_contacts,
    delivery_profile_items,
    delivery_profiles,
    episode_delivery_acceptance_exceptions,
    episode_delivery_items,
    episode_delivery_manifest_shares,
    episode_delivery_manifests,
    episode_team_assignments,
    episodes,
    notifications,
    organization_members,
    people,
    post_work_orders,
    seasons,
    show_contacts,
    shows,
    users,
    workflow_stages,
)
from app.delivery_lifecycle import (
    delivery_manifest_readiness,
    delivery_workflow_gate_state,
    validate_delivery_item_transition,
)

router = APIRouter(tags=["deliveries"])


def _profile_value(row: object) -> dict[str, object]:
    return {
        "id": row.id,
        "client_company_id": row.client_company_id,
        "network": row.network,
        "show_id": row.show_id,
        "name": row.name,
        "specification_url": row.specification_url,
        "is_active": row.is_active,
        "updated_at": getattr(row, "updated_at", None),
    }


def _profile_item_value(row: object) -> dict[str, object]:
    return {
        "id": row.id,
        "component_type": row.component_type,
        "label": row.label,
        "required": row.required,
        "format_specification": row.format_specification,
        "version": row.version,
        "territory": row.territory,
        "language": row.language,
        "recipient_contact_id": row.recipient_contact_id,
        "recipient_name": getattr(row, "recipient_name", None),
        "recipient_email": getattr(row, "recipient_email", None),
        "requires_external_recipient": row.requires_external_recipient,
        "qc_required": row.qc_required,
        "default_deadline_offset_days": row.default_deadline_offset_days,
        "position": row.position,
    }


async def _profile(session: DbSession, organization_id: str, profile_id: str) -> object:
    row = (
        await session.execute(
            select(delivery_profiles).where(
                and_(
                    delivery_profiles.c.id == profile_id,
                    delivery_profiles.c.organization_id == organization_id,
                )
            )
        )
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery profile not found.")
    return row


async def _profile_items(session: DbSession, organization_id: str, profile_id: str) -> list[dict[str, object]]:
    rows = (
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
                    delivery_profile_items.c.delivery_profile_id == profile_id,
                )
            )
            .order_by(delivery_profile_items.c.position, delivery_profile_items.c.id)
        )
    ).all()
    return [_profile_item_value(row) for row in rows]


async def _profile_response(session: DbSession, organization_id: str, profile_id: str) -> dict[str, object]:
    profile = await _profile(session, organization_id, profile_id)
    items = await _profile_items(session, organization_id, profile_id)
    return {
        **_profile_value(profile),
        "items": items,
        "missing_required_recipient_count": sum(
            1 for item in items if item["requires_external_recipient"] and not item["recipient_contact_id"]
        ),
    }


async def _validate_profile_scope(
    session: DbSession,
    organization_id: str,
    *,
    client_company_id: str | None,
    network: str | None,
    show_id: str | None,
) -> None:
    if client_company_id:
        company = (
            await session.execute(
                select(crm_companies.c.type).where(
                    and_(
                        crm_companies.c.id == client_company_id,
                        crm_companies.c.organization_id == organization_id,
                    )
                )
            )
        ).first()
        if not company or company.type == "vendor":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Client or network account not found in this post house.",
            )
    if not show_id:
        return
    show = (
        await session.execute(
            select(shows.c.id, shows.c.client_company_id, shows.c.network).where(
                and_(shows.c.id == show_id, shows.c.organization_id == organization_id)
            )
        )
    ).first()
    if not show:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found in this post house.")
    if client_company_id and client_company_id != show.client_company_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The selected show belongs to a different client account."
        )
    if network and network != show.network:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The selected show belongs to a different network."
        )


async def _validate_profile_recipient(
    session: DbSession, organization_id: str, profile: object, contact_id: str | None
) -> None:
    if not contact_id:
        return
    show_contact_exists = exists(
        select(show_contacts.c.id).where(
            and_(
                show_contacts.c.organization_id == organization_id,
                show_contacts.c.show_id == profile.show_id,
                show_contacts.c.contact_id == crm_contacts.c.id,
            )
        )
    )
    allowed = (
        and_(show_contact_exists, crm_contacts.c.contact_type.in_(("technical_delivery", "client_review")))
        if profile.show_id
        else False
    )
    row = (
        await session.execute(
            select(crm_contacts.c.id)
            .join(
                crm_companies,
                and_(
                    crm_companies.c.id == crm_contacts.c.company_id,
                    crm_companies.c.organization_id == organization_id,
                ),
            )
            .where(
                and_(
                    crm_contacts.c.id == contact_id,
                    crm_contacts.c.organization_id == organization_id,
                    or_(allowed, crm_companies.c.type.in_(("network", "studio"))),
                )
            )
        )
    ).first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Choose a show delivery contact or an eligible network/studio contact.",
        )


async def _episode_scope(session: DbSession, organization_id: str, episode_id: str) -> object:
    row = (
        await session.execute(
            select(
                episodes.c.id.label("episode_id"),
                shows.c.id.label("show_id"),
                shows.c.client_company_id,
                shows.c.network,
                episodes.c.delivery_deadline,
            )
            .join(seasons, and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == organization_id))
            .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == organization_id))
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == organization_id))
        )
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found in this post house.")
    return row


def _profile_applies_to_episode(profile: object, episode: object) -> None:
    if profile.show_id and profile.show_id != episode.show_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This delivery profile is restricted to a different show."
        )
    if profile.client_company_id and profile.client_company_id != episode.client_company_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This delivery profile belongs to a different client account."
        )
    if profile.network and profile.network != episode.network:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This delivery profile belongs to a different network."
        )


async def _write_activity(
    session: DbSession,
    actor: CurrentActor,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, object] | None = None,
) -> str:
    result = await session.execute(
        insert(activity_log)
        .values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=metadata or {},
        )
        .returning(activity_log.c.id)
    )
    return str(result.scalar_one())


async def _eligible_episode_recipient(
    session: DbSession, organization_id: str, episode: object, contact_id: str | None
) -> object | None:
    """Return an eligible show/network recipient, never an arbitrary CRM contact."""
    if not contact_id:
        return None
    show_contact_exists = exists(
        select(show_contacts.c.id).where(
            and_(
                show_contacts.c.organization_id == organization_id,
                show_contacts.c.show_id == episode.show_id,
                show_contacts.c.contact_id == crm_contacts.c.id,
            )
        )
    )
    return (
        await session.execute(
            select(crm_contacts.c.id, crm_contacts.c.name, crm_contacts.c.email)
            .join(
                crm_companies,
                and_(
                    crm_companies.c.id == crm_contacts.c.company_id,
                    crm_companies.c.organization_id == organization_id,
                ),
            )
            .where(
                and_(
                    crm_contacts.c.id == contact_id,
                    crm_contacts.c.organization_id == organization_id,
                    or_(
                        and_(
                            show_contact_exists,
                            crm_contacts.c.contact_type.in_(("technical_delivery", "client_review")),
                        ),
                        crm_companies.c.type.in_(("network", "studio")),
                    ),
                )
            )
        )
    ).first()


async def _manifest_items(session: DbSession, organization_id: str, manifest_id: str) -> list[object]:
    return (
        await session.execute(
            select(episode_delivery_items)
            .where(
                and_(
                    episode_delivery_items.c.organization_id == organization_id,
                    episode_delivery_items.c.episode_delivery_manifest_id == manifest_id,
                )
            )
            .order_by(episode_delivery_items.c.position, episode_delivery_items.c.id)
        )
    ).all()


def _manifest_item_value(row: object) -> dict[str, object]:
    return {
        "id": row.id,
        "component_type": row.component_type,
        "label": row.label,
        "required": row.required,
        "format_specification": row.format_specification,
        "version": row.version,
        "territory": row.territory,
        "language": row.language,
        "recipient_contact_id": row.recipient_contact_id,
        "recipient_name": row.recipient_name,
        "recipient_email": row.recipient_email,
        "requires_external_recipient": row.requires_external_recipient,
        "qc_required": row.qc_required,
        "status": row.status,
        "due_date": row.due_date,
        "external_url": row.external_url,
        "external_reference": row.external_reference,
        "is_externally_shared": row.is_externally_shared,
        "submission_method": row.submission_method,
        "qc_result": row.qc_result,
        "receipt_confirmed_at": row.receipt_confirmed_at,
        "receipt_confirmed_by": row.receipt_confirmed_by,
        "rejection_reason": row.rejection_reason,
        "waiver_reason": row.waiver_reason,
        "position": row.position,
    }


async def _manifest_response(session: DbSession, organization_id: str, episode_id: str) -> dict[str, object]:
    manifest = (
        await session.execute(
            select(episode_delivery_manifests).where(
                and_(
                    episode_delivery_manifests.c.organization_id == organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if not manifest:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery manifest not found.")
    items = await _manifest_items(session, organization_id, str(manifest.id))
    history_rows = (
        await session.execute(
            select(
                activity_log.c.id,
                activity_log.c.action,
                activity_log.c.metadata,
                activity_log.c.created_at,
                users.c.name.label("actor_name"),
            )
            .outerjoin(users, users.c.id == activity_log.c.actor_user_id)
            .where(
                and_(
                    activity_log.c.organization_id == organization_id,
                    activity_log.c.metadata["episodeId"].as_string() == episode_id,
                    or_(
                        activity_log.c.action.like("episode_delivery_%"),
                        activity_log.c.action.like("delivery_%"),
                    ),
                )
            )
            .order_by(activity_log.c.created_at.desc(), activity_log.c.id.desc())
            .limit(60)
        )
    ).all()
    item_values = [_manifest_item_value(item) for item in items]
    return {
        "id": manifest.id,
        "episode_id": manifest.episode_id,
        "delivery_profile_id": manifest.delivery_profile_id,
        "profile_name": manifest.profile_name,
        "specification_url": manifest.specification_url,
        "applied_at": manifest.applied_at,
        "items": item_values,
        "readiness": delivery_manifest_readiness(item_values),
        "history": [
            {
                "id": str(row.id),
                "action": row.action,
                "metadata": row.metadata,
                "created_at": row.created_at,
                "actor_name": row.actor_name,
            }
            for row in history_rows
        ],
    }


@router.get("/deliveries")
async def list_delivery_register(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return the operational register, including episodes without a manifest.

    The browser must never infer delivery state by mixing a manifest request
    with an unscoped episode list.  Building the register here keeps the
    episode, manifest, workflow and tenant predicates together.
    """
    if actor.active_organization and actor.active_organization.role == "client":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery register not found.")
    if not (
        await has_permission(session, actor, "manage_episode_manifests")
        or await has_permission(session, actor, "update_delivery_items")
        or await has_permission(session, actor, "confirm_delivery_receipt")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied.")

    conditions = [
        episodes.c.organization_id == actor.organization_id,
        seasons.c.organization_id == actor.organization_id,
        shows.c.organization_id == actor.organization_id,
    ]
    if not await may_view_all_episodes(session, actor):
        conditions.append(assigned_episode_condition(actor))
    rows = (
        await session.execute(
            select(
                episodes.c.id.label("episode_id"),
                episodes.c.number.label("episode_number"),
                episodes.c.title.label("episode_title"),
                episodes.c.production_code,
                episodes.c.delivery_deadline,
                episodes.c.workflow_status,
                episodes.c.workflow_stage_id,
                workflow_stages.c.name.label("workflow_stage_name"),
                shows.c.id.label("show_id"),
                shows.c.title.label("show_title"),
                seasons.c.number.label("season_number"),
                episode_delivery_manifests.c.id.label("manifest_id"),
            )
            .select_from(episodes)
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
                    workflow_stages.c.id == episodes.c.workflow_stage_id,
                    workflow_stages.c.organization_id == actor.organization_id,
                ),
            )
            .outerjoin(
                episode_delivery_manifests,
                and_(
                    episode_delivery_manifests.c.episode_id == episodes.c.id,
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                ),
            )
            .where(and_(*conditions))
            .order_by(shows.c.title, seasons.c.number, episodes.c.number)
        )
    ).all()

    entries: list[dict[str, object]] = []
    for row in rows:
        entry: dict[str, object] = {
            "episode_id": row.episode_id,
            "episode_number": row.episode_number,
            "episode_title": row.episode_title,
            "production_code": row.production_code,
            "show_id": row.show_id,
            "show_title": row.show_title,
            "season_number": row.season_number,
            "delivery_deadline": row.delivery_deadline,
            "workflow_state": {
                "display_status": row.workflow_status,
                "primary_stage_name": row.workflow_stage_name,
            },
            "manifest": None,
            "manifest_state": "profile_not_applied",
        }
        if row.manifest_id:
            manifest = await _manifest_response(session, actor.organization_id, str(row.episode_id))
            items = manifest["items"]
            entry["manifest"] = {
                **manifest,
                "readiness": delivery_manifest_readiness(items),
            }
            entry["manifest_state"] = "applied"
        entries.append(entry)
    return {"entries": entries}


async def _notify_delivery_dispatch(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode_id: str,
    contact_id: str | None,
    contact_email: str | None,
    activity_id: str,
    title: str,
    body: str,
) -> None:
    team = (
        await session.execute(
            select(episode_team_assignments.c.person_id).where(
                and_(
                    episode_team_assignments.c.organization_id == actor.organization_id,
                    episode_team_assignments.c.episode_id == episode_id,
                    episode_team_assignments.c.person_id != actor.person_id,
                )
            )
        )
    ).all()
    values: list[dict[str, object]] = [
        {
            "organization_id": actor.organization_id,
            "person_id": row.person_id,
            "crm_contact_id": None,
            "recipient_email": None,
            "activity_id": activity_id,
            "title": title,
            "body": body,
        }
        for row in team
    ]
    if contact_id:
        values.append(
            {
                "organization_id": actor.organization_id,
                "person_id": None,
                "crm_contact_id": contact_id,
                "recipient_email": contact_email,
                "activity_id": activity_id,
                "title": title,
                "body": body,
            }
        )
    if values:
        await session.execute(insert(notifications).values(values))


@router.get("/delivery-profiles")
async def list_delivery_profiles(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_delivery_profiles")
    rows = (
        await session.execute(
            select(delivery_profiles)
            .where(delivery_profiles.c.organization_id == actor.organization_id)
            .order_by(delivery_profiles.c.name, delivery_profiles.c.id)
        )
    ).all()
    return {"profiles": [_profile_value(row) for row in rows]}


@router.get("/delivery-profiles/{profile_id}")
async def get_delivery_profile(profile_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_delivery_profiles")
    return {"profile": await _profile_response(session, actor.organization_id, profile_id)}


@router.post("/delivery-profiles", status_code=status.HTTP_201_CREATED)
async def create_delivery_profile(
    payload: DeliveryProfileCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_delivery_profiles")
    values = payload.model_dump()
    values["name"] = values["name"].strip()
    await _validate_profile_scope(
        session, actor.organization_id, **{key: values[key] for key in ("client_company_id", "network", "show_id")}
    )
    duplicate = (
        await session.execute(
            select(delivery_profiles.c.id).where(
                and_(
                    delivery_profiles.c.organization_id == actor.organization_id,
                    delivery_profiles.c.name == values["name"],
                )
            )
        )
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A delivery profile with that name already exists in this post house.",
        )
    profile_id = (
        await session.execute(
            insert(delivery_profiles)
            .values(organization_id=actor.organization_id, **values)
            .returning(delivery_profiles.c.id)
        )
    ).scalar_one()
    await _write_activity(
        session, actor, action="delivery_profile.created", entity_type="delivery_profile", entity_id=str(profile_id)
    )
    await session.commit()
    return {"profile": await _profile_response(session, actor.organization_id, str(profile_id))}


@router.patch("/delivery-profiles/{profile_id}")
async def update_delivery_profile(
    profile_id: str, payload: DeliveryProfileUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_delivery_profiles")
    profile = await _profile(session, actor.organization_id, profile_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        changes["name"] = changes["name"].strip()
    scope = {
        "client_company_id": changes.get("client_company_id", profile.client_company_id),
        "network": changes.get("network", profile.network),
        "show_id": changes.get("show_id", profile.show_id),
    }
    await _validate_profile_scope(session, actor.organization_id, **scope)
    if "name" in changes:
        duplicate = (
            await session.execute(
                select(delivery_profiles.c.id).where(
                    and_(
                        delivery_profiles.c.organization_id == actor.organization_id,
                        delivery_profiles.c.name == changes["name"],
                        delivery_profiles.c.id != profile_id,
                    )
                )
            )
        ).first()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A delivery profile with that name already exists in this post house.",
            )
    await session.execute(
        update(delivery_profiles)
        .where(and_(delivery_profiles.c.id == profile_id, delivery_profiles.c.organization_id == actor.organization_id))
        .values(**changes, updated_at=datetime.now(UTC))
    )
    await _write_activity(
        session, actor, action="delivery_profile.updated", entity_type="delivery_profile", entity_id=profile_id
    )
    await session.commit()
    return {"profile": await _profile_response(session, actor.organization_id, profile_id)}


@router.post("/delivery-profiles/{profile_id}/items", status_code=status.HTTP_201_CREATED)
async def add_delivery_profile_item(
    profile_id: str, payload: DeliveryProfileItemCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_delivery_profiles")
    profile = await _profile(session, actor.organization_id, profile_id)
    await _validate_profile_recipient(session, actor.organization_id, profile, payload.recipient_contact_id)
    colliding = (
        await session.execute(
            select(delivery_profile_items.c.id).where(
                and_(
                    delivery_profile_items.c.organization_id == actor.organization_id,
                    delivery_profile_items.c.delivery_profile_id == profile_id,
                    delivery_profile_items.c.position == payload.position,
                )
            )
        )
    ).first()
    if colliding:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A delivery item already uses that position on this profile.",
        )
    item_id = (
        await session.execute(
            insert(delivery_profile_items)
            .values(organization_id=actor.organization_id, delivery_profile_id=profile_id, **payload.model_dump())
            .returning(delivery_profile_items.c.id)
        )
    ).scalar_one()
    await _write_activity(
        session,
        actor,
        action="delivery_profile.item_added",
        entity_type="delivery_profile",
        entity_id=profile_id,
        metadata={"deliveryProfileItemId": str(item_id)},
    )
    await session.commit()
    row = (
        await session.execute(
            select(delivery_profile_items).where(
                and_(
                    delivery_profile_items.c.id == item_id,
                    delivery_profile_items.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    return {"item": _profile_item_value(row)}


@router.patch("/delivery-profiles/{profile_id}/items/{item_id}")
async def update_delivery_profile_item(
    profile_id: str,
    item_id: str,
    payload: DeliveryProfileItemUpdateRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, bool]:
    await require_permission(session, actor, "manage_delivery_profiles")
    profile = await _profile(session, actor.organization_id, profile_id)
    item = (
        await session.execute(
            select(delivery_profile_items).where(
                and_(
                    delivery_profile_items.c.id == item_id,
                    delivery_profile_items.c.delivery_profile_id == profile_id,
                    delivery_profile_items.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery profile item not found.")
    changes = payload.model_dump(exclude_unset=True)
    if "recipient_contact_id" in changes:
        await _validate_profile_recipient(session, actor.organization_id, profile, changes["recipient_contact_id"])
    if "position" in changes:
        colliding = (
            await session.execute(
                select(delivery_profile_items.c.id).where(
                    and_(
                        delivery_profile_items.c.organization_id == actor.organization_id,
                        delivery_profile_items.c.delivery_profile_id == profile_id,
                        delivery_profile_items.c.position == changes["position"],
                        delivery_profile_items.c.id != item_id,
                    )
                )
            )
        ).first()
        if colliding:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A delivery item already uses that position on this profile.",
            )
    await session.execute(
        update(delivery_profile_items)
        .where(
            and_(
                delivery_profile_items.c.id == item_id,
                delivery_profile_items.c.delivery_profile_id == profile_id,
                delivery_profile_items.c.organization_id == actor.organization_id,
            )
        )
        .values(**changes, updated_at=datetime.now(UTC))
    )
    await _write_activity(
        session,
        actor,
        action="delivery_profile.item_updated",
        entity_type="delivery_profile",
        entity_id=profile_id,
        metadata={"deliveryProfileItemId": item_id},
    )
    await session.commit()
    return {"ok": True}


@router.post("/episodes/{episode_id}/delivery-manifest/apply")
async def apply_delivery_profile_to_episode(
    episode_id: str, payload: ApplyDeliveryProfileRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_episode_manifests")
    episode = await _episode_scope(session, actor.organization_id, episode_id)
    profile = await _profile(session, actor.organization_id, payload.delivery_profile_id)
    if not profile.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Active delivery profile not found in this post house."
        )
    _profile_applies_to_episode(profile, episode)
    old_manifest = (
        await session.execute(
            select(episode_delivery_manifests.c.id).where(
                and_(
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if old_manifest:
        await session.execute(
            delete(episode_delivery_manifests).where(
                and_(
                    episode_delivery_manifests.c.id == old_manifest.id,
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                )
            )
        )
    manifest_id = (
        await session.execute(
            insert(episode_delivery_manifests)
            .values(
                organization_id=actor.organization_id,
                episode_id=episode_id,
                delivery_profile_id=profile.id,
                profile_name=profile.name,
                specification_url=profile.specification_url,
                applied_by_user_id=actor.user_id,
                applied_at=datetime.now(UTC),
            )
            .returning(episode_delivery_manifests.c.id)
        )
    ).scalar_one()
    item_rows = (
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
                    crm_contacts.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    delivery_profile_items.c.organization_id == actor.organization_id,
                    delivery_profile_items.c.delivery_profile_id == profile.id,
                )
            )
            .order_by(delivery_profile_items.c.position)
        )
    ).all()
    deadline = episode.delivery_deadline.date() if episode.delivery_deadline else None
    if item_rows:
        await session.execute(
            insert(episode_delivery_items).values(
                [
                    {
                        "organization_id": actor.organization_id,
                        "episode_delivery_manifest_id": manifest_id,
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
                            deadline + timedelta(days=item.default_deadline_offset_days or 0) if deadline else None
                        ),
                        "qc_result": "not_started" if item.qc_required else "not_required",
                        "position": item.position,
                    }
                    for item in item_rows
                ]
            )
        )
    await _write_activity(
        session,
        actor,
        action="episode_delivery_manifest.reapplied" if old_manifest else "episode_delivery_manifest.applied",
        entity_type="episode_delivery_manifest",
        entity_id=str(manifest_id),
        metadata={
            "episodeId": episode_id,
            "deliveryProfileId": str(profile.id),
            "reason": payload.reason.strip(),
            "itemCount": len(item_rows),
        },
    )
    await session.commit()
    return {
        "manifest": {
            "id": str(manifest_id),
            "episode_id": episode_id,
            "profile_name": profile.name,
            "item_count": len(item_rows),
        }
    }


@router.get("/episodes/{episode_id}/delivery-recipients")
async def list_delivery_recipients(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    if not (
        await has_permission(session, actor, "manage_episode_manifests")
        or await has_permission(session, actor, "update_delivery_items")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied.")
    episode = await _episode_scope(session, actor.organization_id, episode_id)
    show_contact_exists = exists(
        select(show_contacts.c.id).where(
            and_(
                show_contacts.c.organization_id == actor.organization_id,
                show_contacts.c.show_id == episode.show_id,
                show_contacts.c.contact_id == crm_contacts.c.id,
            )
        )
    )
    contacts = (
        await session.execute(
            select(
                crm_contacts.c.id,
                crm_contacts.c.name,
                crm_contacts.c.email,
                crm_contacts.c.title,
                crm_contacts.c.contact_type,
                crm_companies.c.name.label("company_name"),
                crm_companies.c.type.label("company_type"),
                show_contact_exists.label("show_assigned"),
            )
            .join(
                crm_companies,
                and_(
                    crm_companies.c.id == crm_contacts.c.company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    crm_contacts.c.organization_id == actor.organization_id,
                    or_(
                        and_(
                            show_contact_exists,
                            crm_contacts.c.contact_type.in_(("technical_delivery", "client_review")),
                        ),
                        crm_companies.c.type.in_(("network", "studio")),
                    ),
                )
            )
            .order_by(crm_companies.c.name, crm_contacts.c.name, crm_contacts.c.id)
        )
    ).all()
    return {
        "contacts": [
            {
                "id": row.id,
                "name": row.name,
                "email": row.email,
                "title": row.title,
                "contact_type": row.contact_type,
                "company_name": row.company_name,
                "company_type": row.company_type,
                "show_assigned": row.show_assigned,
            }
            for row in contacts
        ]
    }


@router.post("/episodes/{episode_id}/delivery-items", status_code=status.HTTP_201_CREATED)
async def add_episode_delivery_item(
    episode_id: str, payload: EpisodeDeliveryItemCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_episode_manifests")
    episode = await _episode_scope(session, actor.organization_id, episode_id)
    manifest = (
        await session.execute(
            select(episode_delivery_manifests.c.id).where(
                and_(
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Delivery manifest not found for this episode."
        )
    recipient = await _eligible_episode_recipient(session, actor.organization_id, episode, payload.recipient_contact_id)
    if payload.recipient_contact_id and not recipient:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Choose a show delivery contact or an eligible network/studio contact.",
        )
    maximum_position = (
        await session.execute(
            select(func.max(episode_delivery_items.c.position)).where(
                and_(
                    episode_delivery_items.c.organization_id == actor.organization_id,
                    episode_delivery_items.c.episode_delivery_manifest_id == manifest.id,
                )
            )
        )
    ).scalar_one()
    values = payload.model_dump(exclude={"reason"})
    item_id = (
        await session.execute(
            insert(episode_delivery_items)
            .values(
                organization_id=actor.organization_id,
                episode_delivery_manifest_id=manifest.id,
                episode_id=episode_id,
                **values,
                recipient_name=recipient.name if recipient else None,
                recipient_email=recipient.email if recipient else None,
                status="not_started",
                qc_result="not_started" if payload.qc_required else "not_required",
                position=(maximum_position or 0) + 1,
            )
            .returning(episode_delivery_items.c.id)
        )
    ).scalar_one()
    await _write_activity(
        session,
        actor,
        action="episode_delivery_item.added",
        entity_type="episode_delivery_item",
        entity_id=str(item_id),
        metadata={"episodeId": episode_id, "reason": payload.reason.strip()},
    )
    await session.commit()
    row = (
        await session.execute(
            select(episode_delivery_items).where(
                and_(
                    episode_delivery_items.c.id == item_id,
                    episode_delivery_items.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    return {"item": _manifest_item_value(row)}


@router.patch("/episodes/{episode_id}/delivery-items/{item_id}")
async def update_episode_delivery_item(
    episode_id: str,
    item_id: str,
    payload: EpisodeDeliveryItemUpdateRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, bool]:
    await require_permission(session, actor, "update_delivery_items")
    episode = await _episode_scope(session, actor.organization_id, episode_id)
    item = (
        await session.execute(
            select(episode_delivery_items).where(
                and_(
                    episode_delivery_items.c.id == item_id,
                    episode_delivery_items.c.episode_id == episode_id,
                    episode_delivery_items.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery item not found.")
    changes = payload.model_dump(exclude={"reason"}, exclude_unset=True)
    if "position" in changes:
        colliding = (
            await session.execute(
                select(episode_delivery_items.c.id).where(
                    and_(
                        episode_delivery_items.c.organization_id == actor.organization_id,
                        episode_delivery_items.c.episode_delivery_manifest_id == item.episode_delivery_manifest_id,
                        episode_delivery_items.c.position == changes["position"],
                        episode_delivery_items.c.id != item_id,
                    )
                )
            )
        ).first()
        if colliding:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A delivery item already uses that position on this checklist.",
            )
    if "recipient_contact_id" in changes:
        recipient = await _eligible_episode_recipient(
            session, actor.organization_id, episode, changes["recipient_contact_id"]
        )
        if changes["recipient_contact_id"] and not recipient:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Choose a show delivery contact or an eligible network/studio contact.",
            )
        changes["recipient_name"] = recipient.name if recipient else None
        changes["recipient_email"] = recipient.email if recipient else None
    await session.execute(
        update(episode_delivery_items)
        .where(
            and_(
                episode_delivery_items.c.id == item_id,
                episode_delivery_items.c.episode_id == episode_id,
                episode_delivery_items.c.organization_id == actor.organization_id,
            )
        )
        .values(**changes, updated_at=datetime.now(UTC))
    )
    await _write_activity(
        session,
        actor,
        action="episode_delivery_item.changed",
        entity_type="episode_delivery_item",
        entity_id=item_id,
        metadata={
            "episodeId": episode_id,
            "reason": payload.reason.strip(),
            "changedFields": sorted(changes.keys()),
        },
    )
    await session.commit()
    return {"ok": True}


@router.delete("/episodes/{episode_id}/delivery-items/{item_id}")
async def remove_episode_delivery_item(
    episode_id: str,
    item_id: str,
    payload: EpisodeDeliveryItemRemoveRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, bool]:
    await require_permission(session, actor, "manage_episode_manifests")
    removed = await session.execute(
        delete(episode_delivery_items).where(
            and_(
                episode_delivery_items.c.id == item_id,
                episode_delivery_items.c.episode_id == episode_id,
                episode_delivery_items.c.organization_id == actor.organization_id,
            )
        )
    )
    if not removed.rowcount:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery item not found.")
    await _write_activity(
        session,
        actor,
        action="episode_delivery_item.removed",
        entity_type="episode_delivery_item",
        entity_id=item_id,
        metadata={"episodeId": episode_id, "reason": payload.reason.strip()},
    )
    await session.commit()
    return {"ok": True}


@router.post("/episodes/{episode_id}/delivery-items/{item_id}/transition")
async def transition_delivery_item(
    episode_id: str,
    item_id: str,
    payload: DeliveryItemTransitionRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    required_permission = (
        "confirm_delivery_receipt" if payload.status == "receipt_confirmed" else "update_delivery_items"
    )
    await require_permission(session, actor, required_permission)
    episode = await _episode_scope(session, actor.organization_id, episode_id)
    item = (
        await session.execute(
            select(episode_delivery_items).where(
                and_(
                    episode_delivery_items.c.id == item_id,
                    episode_delivery_items.c.episode_id == episode_id,
                    episode_delivery_items.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery item not found.")
    can_waive = await has_permission(session, actor, "waive_qc")
    next_url = payload.external_url if "external_url" in payload.model_fields_set else item.external_url
    next_reference = (
        payload.external_reference if "external_reference" in payload.model_fields_set else item.external_reference
    )
    validation_error = validate_delivery_item_transition(
        current_status=item.status,
        next_status=payload.status,
        qc_required=item.qc_required,
        has_external_evidence=bool(next_url or next_reference),
        has_reason=bool(payload.reason.strip()),
        can_waive=can_waive,
        can_record_rejection=True,
    )
    if validation_error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=validation_error)
    recipient = (
        await _eligible_episode_recipient(session, actor.organization_id, episode, item.recipient_contact_id)
        if payload.status == "dispatched"
        else None
    )
    if payload.status == "dispatched" and item.requires_external_recipient and not recipient:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This required delivery item needs an eligible external recipient before dispatch.",
        )
    now = datetime.now(UTC)
    changes: dict[str, object] = {"status": payload.status, "updated_at": now}
    if "external_url" in payload.model_fields_set:
        changes["external_url"] = payload.external_url
    if "external_reference" in payload.model_fields_set:
        changes["external_reference"] = payload.external_reference
    if "submission_method" in payload.model_fields_set:
        changes["submission_method"] = payload.submission_method
    if payload.status == "ready_for_qc":
        changes["qc_result"] = "not_started" if item.qc_required else "not_required"
    elif payload.status == "qc_failed":
        changes["qc_result"] = "failed"
    elif payload.status == "qc_passed":
        changes["qc_result"] = "passed"
    elif payload.status == "dispatched":
        changes.update(
            {
                "submitted_at": now,
                "submitted_by_person_id": actor.person_id,
                "recipient_name": recipient.name if recipient else None,
                "recipient_email": recipient.email if recipient else None,
                "recipient_snapshot_at": now if recipient else None,
            }
        )
    elif payload.status == "receipt_confirmed":
        changes.update(
            {
                "receipt_confirmed_at": now,
                "receipt_confirmed_by": payload.receipt_confirmed_by or "Recipient confirmation recorded",
            }
        )
    elif payload.status == "rejected":
        changes["rejection_reason"] = payload.reason.strip()
    elif payload.status == "waived":
        changes["waiver_reason"] = payload.reason.strip()
        if item.qc_required:
            changes["qc_result"] = "waived"
    await session.execute(
        update(episode_delivery_items)
        .where(
            and_(
                episode_delivery_items.c.id == item_id,
                episode_delivery_items.c.episode_id == episode_id,
                episode_delivery_items.c.organization_id == actor.organization_id,
            )
        )
        .values(**changes)
    )
    correction_work_order_id: str | None = None
    if payload.status in {"qc_failed", "rejected"}:
        existing = (
            await session.execute(
                select(post_work_orders.c.id).where(
                    and_(
                        post_work_orders.c.organization_id == actor.organization_id,
                        post_work_orders.c.episode_id == episode_id,
                        post_work_orders.c.delivery_item_id == item_id,
                        post_work_orders.c.kind == "delivery_correction",
                        post_work_orders.c.status.not_in(("complete", "cancelled")),
                    )
                )
            )
        ).first()
        if existing:
            correction_work_order_id = str(existing.id)
        else:
            correction_work_order_id = str(
                (
                    await session.execute(
                        insert(post_work_orders)
                        .values(
                            organization_id=actor.organization_id,
                            episode_id=episode_id,
                            delivery_item_id=item_id,
                            kind="delivery_correction",
                            title=f"Delivery correction — {item.label}",
                            description=payload.reason.strip(),
                            priority="blocker",
                            is_blocking=True,
                            status="open",
                            external_url=next_url,
                            created_by_user_id=actor.user_id,
                        )
                        .returning(post_work_orders.c.id)
                    )
                ).scalar_one()
            )
            await _write_activity(
                session,
                actor,
                action="delivery_correction_work_order.created",
                entity_type="post_work_order",
                entity_id=correction_work_order_id,
                metadata={"episodeId": episode_id, "deliveryItemId": item_id, "trigger": payload.status},
            )
    action = (
        "episode_delivery_item.submitted"
        if payload.status == "ready_for_qc"
        else "episode_delivery_item.qc_result"
        if payload.status in {"qc_failed", "qc_passed"}
        else f"episode_delivery_item.{payload.status}"
    )
    activity_id = await _write_activity(
        session,
        actor,
        action=action,
        entity_type="episode_delivery_item",
        entity_id=item_id,
        metadata={
            "episodeId": episode_id,
            "fromStatus": item.status,
            "toStatus": payload.status,
            "reason": payload.reason.strip(),
            "correctionWorkOrderId": correction_work_order_id,
        },
    )
    if payload.status in {"dispatched", "rejected"}:
        notification_title = (
            "Delivery dispatched — receipt requested" if payload.status == "dispatched" else "Delivery rejected"
        )
        notification_body = (
            f"{item.label} was dispatched and is awaiting recipient receipt confirmation."
            if payload.status == "dispatched"
            else f"{item.label} was rejected and needs corrective action."
        )
        await _notify_delivery_dispatch(
            session,
            actor,
            episode_id=episode_id,
            contact_id=item.recipient_contact_id,
            contact_email=recipient.email if recipient else item.recipient_email,
            activity_id=activity_id,
            title=notification_title,
            body=notification_body,
        )
    await session.commit()
    return {"manifest": await _manifest_response(session, actor.organization_id, episode_id)}


@router.post("/episodes/{episode_id}/delivery-acceptance-exception")
async def authorise_delivery_acceptance_exception(
    episode_id: str,
    payload: DeliveryAcceptanceExceptionRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    """Record a controlled local substitute for external receipt confirmation.

    This is deliberately narrower than a delivery waiver: required items must
    already have passed their QC and been dispatched.  It exists for the
    common operational case where a network confirms outside the portal.
    """
    await require_permission(session, actor, "authorize_delivery_exceptions")
    await _episode_scope(session, actor.organization_id, episode_id)
    stage = (
        await session.execute(
            select(workflow_stages.c.id, workflow_stages.c.delivery_gate).where(
                and_(
                    workflow_stages.c.id == payload.workflow_stage_id,
                    workflow_stages.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not stage or stage.delivery_gate != "client_acceptance":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Choose the configured client/network acceptance stage.",
        )
    manifest = (
        await session.execute(
            select(episode_delivery_manifests.c.id).where(
                and_(
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No delivery manifest is applied to this episode.",
        )
    manifest_items = await _manifest_items(session, actor.organization_id, str(manifest.id))
    items = [_manifest_item_value(item) for item in manifest_items]
    gate = delivery_workflow_gate_state(items, "client_acceptance")
    if not gate["facility_ready"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(gate["message"] or "Required delivery items are not ready for acceptance."),
        )
    if gate["client_receipt_complete"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Every required item already has recipient receipt confirmation.",
        )
    now = datetime.now(UTC)
    exception_id = (
        await session.execute(
            pg_insert(episode_delivery_acceptance_exceptions)
            .values(
                organization_id=actor.organization_id,
                episode_id=episode_id,
                workflow_stage_id=stage.id,
                reason=payload.reason.strip(),
                authorised_by_user_id=actor.user_id,
                authorised_at=now,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=["episode_id", "workflow_stage_id"],
                set_={
                    "reason": payload.reason.strip(),
                    "authorised_by_user_id": actor.user_id,
                    "authorised_at": now,
                    "updated_at": now,
                },
            )
            .returning(episode_delivery_acceptance_exceptions.c.id)
        )
    ).scalar_one()
    await _write_activity(
        session,
        actor,
        action="episode_delivery_acceptance_exception.authorized",
        entity_type="episode_delivery_acceptance_exception",
        entity_id=str(exception_id),
        metadata={"episodeId": episode_id, "workflowStageId": str(stage.id), "reason": payload.reason.strip()},
    )
    await session.commit()
    return {"ok": True, "exception": {"id": str(exception_id)}}


@router.post("/episodes/{episode_id}/delivery-manifest/shared", status_code=status.HTTP_201_CREATED)
async def share_delivery_manifest(
    episode_id: str, payload: DeliveryManifestShareRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_episode_manifests")
    manifest = (
        await session.execute(
            select(episode_delivery_manifests.c.id).where(
                and_(
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if not manifest:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery manifest not found.")
    target = (
        await session.execute(
            select(people.c.id)
            .join(
                organization_members,
                and_(
                    organization_members.c.organization_id == actor.organization_id,
                    organization_members.c.user_id == people.c.user_id,
                ),
            )
            .where(
                and_(
                    people.c.id == payload.person_id,
                    people.c.organization_id == actor.organization_id,
                    organization_members.c.role == "client",
                )
            )
        )
    ).first()
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="External recipient not found in this post house."
        )
    existing = (
        await session.execute(
            select(episode_delivery_manifest_shares.c.id).where(
                and_(
                    episode_delivery_manifest_shares.c.organization_id == actor.organization_id,
                    episode_delivery_manifest_shares.c.episode_delivery_manifest_id == manifest.id,
                    episode_delivery_manifest_shares.c.person_id == payload.person_id,
                )
            )
        )
    ).first()
    if existing:
        share_id = existing.id
        await session.execute(
            update(episode_delivery_manifest_shares)
            .where(episode_delivery_manifest_shares.c.id == existing.id)
            .values(shared_by_user_id=actor.user_id, updated_at=datetime.now(UTC))
        )
    else:
        share_id = (
            await session.execute(
                insert(episode_delivery_manifest_shares)
                .values(
                    organization_id=actor.organization_id,
                    episode_delivery_manifest_id=manifest.id,
                    person_id=payload.person_id,
                    shared_by_user_id=actor.user_id,
                )
                .returning(episode_delivery_manifest_shares.c.id)
            )
        ).scalar_one()
    await _write_activity(
        session,
        actor,
        action="episode_delivery_manifest.shared",
        entity_type="episode_delivery_manifest",
        entity_id=str(manifest.id),
        metadata={"episodeId": episode_id, "personId": payload.person_id},
    )
    await session.commit()
    return {"ok": True, "share": {"id": str(share_id)}}


@router.delete("/episodes/{episode_id}/delivery-manifest/shared")
async def unshare_delivery_manifest(
    episode_id: str, payload: DeliveryManifestShareRequest, actor: CurrentActor, session: DbSession
) -> dict[str, bool]:
    await require_permission(session, actor, "manage_episode_manifests")
    manifest = (
        await session.execute(
            select(episode_delivery_manifests.c.id).where(
                and_(
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if not manifest:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery manifest not found.")
    removed = await session.execute(
        delete(episode_delivery_manifest_shares).where(
            and_(
                episode_delivery_manifest_shares.c.organization_id == actor.organization_id,
                episode_delivery_manifest_shares.c.episode_delivery_manifest_id == manifest.id,
                episode_delivery_manifest_shares.c.person_id == payload.person_id,
            )
        )
    )
    if not removed.rowcount:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External manifest share not found.")
    await _write_activity(
        session,
        actor,
        action="episode_delivery_manifest.unshared",
        entity_type="episode_delivery_manifest",
        entity_id=str(manifest.id),
        metadata={"episodeId": episode_id, "personId": payload.person_id},
    )
    await session.commit()
    return {"ok": True}


@router.get("/episodes/{episode_id}/delivery-manifest/shared")
async def get_shared_delivery_manifest(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "view_shared_delivery_status")
    if not actor.person_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No active external account.")
    manifest = (
        await session.execute(
            select(episode_delivery_manifests)
            .join(
                episode_delivery_manifest_shares,
                and_(
                    episode_delivery_manifest_shares.c.episode_delivery_manifest_id == episode_delivery_manifests.c.id,
                    episode_delivery_manifest_shares.c.organization_id == actor.organization_id,
                    episode_delivery_manifest_shares.c.person_id == actor.person_id,
                ),
            )
            .where(
                and_(
                    episode_delivery_manifests.c.organization_id == actor.organization_id,
                    episode_delivery_manifests.c.episode_id == episode_id,
                )
            )
        )
    ).first()
    if not manifest:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared delivery manifest not found.")
    items = await _manifest_items(session, actor.organization_id, str(manifest.id))
    return {
        "id": manifest.id,
        "episode_id": manifest.episode_id,
        "profile_name": manifest.profile_name,
        "applied_at": manifest.applied_at,
        "items": [
            {
                "id": item.id,
                "component_type": item.component_type,
                "label": item.label,
                "required": item.required,
                "version": item.version,
                "territory": item.territory,
                "language": item.language,
                "status": item.status,
                "due_date": item.due_date,
                "external_url": item.external_url if item.is_externally_shared else None,
                "external_reference": item.external_reference if item.is_externally_shared else None,
                "submission_method": item.submission_method,
                "receipt_confirmed_at": item.receipt_confirmed_at,
                "position": item.position,
            }
            for item in items
        ],
    }
