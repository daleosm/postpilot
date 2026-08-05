"""Tenant-owned service catalogue and inherited master-to-episode rate cards."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, delete, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    RateCardOverrideRequest,
    ServiceRateCreateRequest,
    ServiceRateUpdateRequest,
)
from app.auth import require_permission
from app.budget_logic import decimal_amount, json_safe, monetary
from app.db.tables import (
    activity_log,
    crm_companies,
    episodes,
    organization_role_policies,
    people,
    rate_card_items,
    rate_cards,
    rooms,
    seasons,
    service_rates,
    shows,
)

router = APIRouter(prefix="/rate-cards", tags=["rate-cards"])

# These values are deliberately a commercial vocabulary rather than a list of
# facility services or job roles. Services, rooms, and named artists stay
# tenant-configured records.
SUPPORTED_BILLING_UNITS = frozenset({"hour", "half_day", "day", "week", "episode", "fixed", "unit"})


def _scope_name(card: object) -> str:
    if card.episode_id:
        return "episode"
    if card.show_id:
        return "show"
    if card.network:
        return "network"
    if card.client_company_id:
        return "client"
    return "master"


def _card_response(card: object, items: list[object]) -> dict[str, object]:
    return {
        "id": str(card.id),
        "scope": _scope_name(card),
        "name": card.name,
        "currency": card.currency,
        "network": card.network,
        "client_company_id": str(card.client_company_id) if card.client_company_id else None,
        "show_id": str(card.show_id) if card.show_id else None,
        "episode_id": str(card.episode_id) if card.episode_id else None,
        "is_active": card.is_active,
        "items": [
            {
                "id": str(item.id),
                "service_rate_id": str(item.service_rate_id) if item.service_rate_id else None,
                "target_type": item.target_type,
                "room_id": str(item.room_id) if item.room_id else None,
                "person_id": str(item.person_id) if item.person_id else None,
                "category": item.category,
                "artist_role": item.artist_role,
                "unit": item.unit,
                "rate": monetary(decimal_amount(item.rate)),
                "client_rate": monetary(decimal_amount(item.rate)),
                "internal_cost_rate": (
                    monetary(decimal_amount(item.internal_cost_rate)) if item.internal_cost_rate is not None else None
                ),
            }
            for item in items
        ],
    }


def _service_response(service: object) -> dict[str, object]:
    return {
        "id": str(service.id),
        "name": service.name,
        "category": service.category,
        "artist_role": service.artist_role,
        "unit": service.unit,
        "rate": monetary(decimal_amount(service.rate)),
        "currency": service.currency,
        "notes": service.notes,
        "is_active": service.is_active,
    }


async def _audit(
    session: DbSession,
    actor: CurrentActor,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, object],
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=json_safe(metadata),
        )
    )


async def _episode_context(session: DbSession, actor: CurrentActor, episode_id: str) -> object:
    episode = (
        await session.execute(
            select(
                episodes.c.id,
                shows.c.id.label("show_id"),
                shows.c.title.label("show_title"),
                shows.c.network,
                shows.c.client_company_id,
            )
            .select_from(episodes)
            .join(
                seasons,
                and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
            )
            .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    return episode


async def _artist_role_or_422(session: DbSession, actor: CurrentActor, artist_role: str | None) -> str | None:
    """Accept only a role configured by this post house as a rate target."""
    role = artist_role.strip() if artist_role else None
    if not role:
        return None
    configured = (
        await session.execute(
            select(organization_role_policies.c.role).where(
                and_(
                    organization_role_policies.c.organization_id == actor.organization_id,
                    organization_role_policies.c.role == role,
                )
            )
        )
    ).first()
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a role configured for this post house.",
        )
    return role


async def _scope_target(
    session: DbSession, actor: CurrentActor, payload: RateCardOverrideRequest
) -> tuple[dict[str, object], str]:
    """Validate an override target and return canonical rate-card columns."""
    if payload.scope == "master":
        return {}, "Master rate card"
    if payload.scope == "network":
        network = payload.network.strip() if payload.network else ""
        return {"network": network}, f"{network} · Network rate card"
    if payload.scope == "client":
        company = (
            await session.execute(
                select(crm_companies.c.id, crm_companies.c.name).where(
                    and_(
                        crm_companies.c.id == payload.client_company_id,
                        crm_companies.c.organization_id == actor.organization_id,
                    )
                )
            )
        ).first()
        if not company:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client account not found.")
        return {"client_company_id": company.id}, f"{company.name} · Client rate card"
    if payload.scope == "show":
        show = (
            await session.execute(
                select(shows.c.id, shows.c.title).where(
                    and_(shows.c.id == payload.show_id, shows.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not show:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
        return {"show_id": show.id}, f"{show.title} · Show rate card"
    episode = await _episode_context(session, actor, payload.episode_id or "")
    return {"episode_id": episode.id}, f"{episode.show_title} · Episode rate card"


async def _scope_target_from_query(
    session: DbSession,
    actor: CurrentActor,
    *,
    scope: str,
    network: str | None,
    client_company_id: str | None,
    show_id: str | None,
    episode_id: str | None,
) -> dict[str, object]:
    """Validate a read-only card scope without creating an empty card."""
    if scope == "master":
        return {}
    if scope == "network":
        if not network or not network.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a network rate-card scope.")
        return {"network": network.strip()}
    if scope == "client":
        company = (
            await session.execute(
                select(crm_companies.c.id).where(
                    and_(
                        crm_companies.c.id == client_company_id,
                        crm_companies.c.organization_id == actor.organization_id,
                    )
                )
            )
        ).first()
        if not company:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client account not found.")
        return {"client_company_id": company.id}
    if scope == "show":
        show = (
            await session.execute(
                select(shows.c.id).where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
            )
        ).first()
        if not show:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
        return {"show_id": show.id}
    if scope == "episode":
        episode = await _episode_context(session, actor, episode_id or "")
        return {"episode_id": episode.id}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid rate-card scope.")


def _scope_conditions(scope: str, target: dict[str, object]) -> list[object]:
    """Exact scope matching prevents an inconsistent card from shadowing one."""
    base = [
        rate_cards.c.client_company_id.is_(None),
        rate_cards.c.network.is_(None),
        rate_cards.c.show_id.is_(None),
        rate_cards.c.episode_id.is_(None),
    ]
    if scope == "master":
        return base
    if scope == "network":
        return [
            rate_cards.c.network == target["network"],
            rate_cards.c.client_company_id.is_(None),
            rate_cards.c.show_id.is_(None),
            rate_cards.c.episode_id.is_(None),
        ]
    if scope == "client":
        return [
            rate_cards.c.client_company_id == target["client_company_id"],
            rate_cards.c.network.is_(None),
            rate_cards.c.show_id.is_(None),
            rate_cards.c.episode_id.is_(None),
        ]
    if scope == "show":
        return [
            rate_cards.c.show_id == target["show_id"],
            rate_cards.c.client_company_id.is_(None),
            rate_cards.c.network.is_(None),
            rate_cards.c.episode_id.is_(None),
        ]
    return [
        rate_cards.c.episode_id == target["episode_id"],
        rate_cards.c.client_company_id.is_(None),
        rate_cards.c.network.is_(None),
        rate_cards.c.show_id.is_(None),
    ]


async def _card_for_scope(
    session: DbSession,
    actor: CurrentActor,
    *,
    scope: str,
    target: dict[str, object],
    name: str,
) -> object:
    card = (
        await session.execute(
            select(rate_cards)
            .where(and_(rate_cards.c.organization_id == actor.organization_id, *_scope_conditions(scope, target)))
            .order_by(rate_cards.c.created_at.desc(), rate_cards.c.id)
            .limit(1)
        )
    ).first()
    if card:
        return card
    now = datetime.now(UTC)
    created = await session.execute(
        insert(rate_cards)
        .values(
            organization_id=actor.organization_id,
            **target,
            name=name,
            currency=actor.active_organization.currency,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        .returning(rate_cards)
    )
    return created.first()


async def _service_or_404(session: DbSession, actor: CurrentActor, service_rate_id: str) -> object:
    service = (
        await session.execute(
            select(service_rates)
            .where(
                and_(
                    service_rates.c.id == service_rate_id,
                    service_rates.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service rate not found.")
    return service


async def _item_target(session: DbSession, actor: CurrentActor, payload: RateCardOverrideRequest) -> dict[str, object]:
    """Resolve an explicit, tenant-owned rate-card target.

    A resource ID from another organization must be indistinguishable from a
    missing resource. This prevents card editing from becoming a tenant data
    discovery surface.
    """
    if payload.target_type == "service":
        return {"target_type": "service", "room_id": None, "person_id": None}
    if payload.target_type == "room":
        room = (
            await session.execute(
                select(rooms.c.id).where(
                    and_(rooms.c.id == payload.room_id, rooms.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
        return {"target_type": "room", "room_id": room.id, "person_id": None}
    person = (
        await session.execute(
            select(people.c.id).where(
                and_(people.c.id == payload.person_id, people.c.organization_id == actor.organization_id)
            )
        )
    ).first()
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found.")
    return {"target_type": "person", "room_id": None, "person_id": person.id}


async def _all_cards(session: DbSession, actor: CurrentActor) -> list[object]:
    return (
        await session.execute(
            select(rate_cards)
            .where(rate_cards.c.organization_id == actor.organization_id)
            .order_by(rate_cards.c.created_at.desc(), rate_cards.c.id)
        )
    ).all()


async def _items_for_cards(session: DbSession, actor: CurrentActor, card_ids: list[object]) -> dict[str, list[object]]:
    if not card_ids:
        return {}
    rows = (
        await session.execute(
            select(rate_card_items)
            .where(
                and_(
                    rate_card_items.c.organization_id == actor.organization_id,
                    rate_card_items.c.rate_card_id.in_(card_ids),
                )
            )
            .order_by(rate_card_items.c.category, rate_card_items.c.unit, rate_card_items.c.id)
        )
    ).all()
    grouped: dict[str, list[object]] = {}
    for item in rows:
        grouped.setdefault(str(item.rate_card_id), []).append(item)
    return grouped


async def resolve_effective_rate(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode_id: str,
    category: str,
    unit: str,
    target_type: str | None = None,
    target_id: str | None = None,
) -> dict[str, object]:
    """Resolve a target rate, then a generic service at every scope tier.

    Named resource rows never escape their scope. The ordered path is episode
    target/service, show target/service, network+client targets, network+client
    services, then master target/service. Network remains ahead of client when
    both define an equally-specific row, preserving the existing card policy.
    """
    if unit not in SUPPORTED_BILLING_UNITS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a supported billing unit.",
        )
    if target_type not in {None, "room", "person"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a valid rate target.")
    if bool(target_type) != bool(target_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A named rate lookup needs both target type and target ID.",
        )
    person_role: str | None = None
    if target_type == "room":
        target_exists = (
            await session.execute(
                select(rooms.c.id).where(
                    and_(rooms.c.id == target_id, rooms.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not target_exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    elif target_type == "person":
        target_exists = (
            await session.execute(
                select(people.c.id, people.c.role).where(
                    and_(people.c.id == target_id, people.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not target_exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found.")
        person_role = str(target_exists.role or "") or None
    episode = await _episode_context(session, actor, episode_id)
    cards = [card for card in await _all_cards(session, actor) if card.is_active]
    card_ids = [card.id for card in cards]
    items = await _items_for_cards(session, actor, card_ids)
    source_filters = {
        "episode_rate_card": lambda card: (
            str(card.episode_id or "") == str(episode.id)
            and not card.client_company_id
            and not card.network
            and not card.show_id
        ),
        "show_rate_card": lambda card: (
            card.show_id
            and str(card.show_id) == str(episode.show_id)
            and not card.client_company_id
            and not card.network
            and not card.episode_id
        ),
        "network_rate_card": lambda card: (
            card.network
            and card.network == episode.network
            and not card.client_company_id
            and not card.show_id
            and not card.episode_id
        ),
        "client_rate_card": lambda card: (
            card.client_company_id
            and str(card.client_company_id) == str(episode.client_company_id or "")
            and not card.network
            and not card.show_id
            and not card.episode_id
        ),
        "master_rate_card": lambda card: (
            not card.client_company_id and not card.network and not card.show_id and not card.episode_id
        ),
    }
    scope_tiers = (
        ("episode_rate_card",),
        ("show_rate_card",),
        ("network_rate_card", "client_rate_card"),
        ("master_rate_card",),
    )
    for sources in scope_tiers:
        # Check exact artist/room targets across a whole tier before falling
        # back to generic services. This matters when a show belongs to both
        # a network and client account: either named exception wins over a
        # generic commercial rate at the other peer scope.
        target_kinds = (
            ("target", "artist_role", "service")
            if target_type == "person" and person_role
            else ("target", "service")
            if target_type
            else ("service",)
        )
        for kind in target_kinds:
            for source in sources:
                for card in cards:
                    if not source_filters[source](card):
                        continue
                    entries = items.get(str(card.id), [])
                    if kind == "target":
                        item = next(
                            (
                                entry
                                for entry in entries
                                if entry.target_type == target_type
                                and str(entry.person_id if target_type == "person" else entry.room_id) == str(target_id)
                                and entry.unit == unit
                            ),
                            None,
                        )
                    elif kind == "artist_role":
                        item = next(
                            (
                                entry
                                for entry in entries
                                if entry.target_type == "service"
                                and entry.artist_role == person_role
                                and entry.unit == unit
                            ),
                            None,
                        )
                    else:
                        item = next(
                            (
                                entry
                                for entry in entries
                                if entry.target_type == "service" and entry.category == category and entry.unit == unit
                            ),
                            None,
                        )
                    if not item:
                        continue
                    resolved: dict[str, object] = {
                        "rate": monetary(decimal_amount(item.rate)),
                        "currency": card.currency,
                        "source": source,
                        "card_id": str(card.id),
                        "item_id": str(item.id),
                        "category": item.category,
                        "artist_role": item.artist_role,
                    }
                    if item.target_type != "service" or item.internal_cost_rate is not None:
                        resolved.update(
                            {
                                "client_rate": monetary(decimal_amount(item.rate)),
                                "internal_cost_rate": (
                                    monetary(decimal_amount(item.internal_cost_rate))
                                    if item.internal_cost_rate is not None
                                    else None
                                ),
                                "target_type": item.target_type,
                                "room_id": str(item.room_id) if item.room_id else None,
                                "person_id": str(item.person_id) if item.person_id else None,
                            }
                        )
                    return resolved
    facility = (
        await session.execute(
            select(service_rates)
            .where(
                and_(
                    service_rates.c.organization_id == actor.organization_id,
                    service_rates.c.category == category,
                    service_rates.c.unit == unit,
                    service_rates.c.is_active.is_(True),
                )
            )
            .order_by(service_rates.c.name, service_rates.c.id)
            .limit(1)
        )
    ).first()
    if not facility:
        return {
            "rate": None,
            "currency": actor.active_organization.currency,
            "source": None,
            "card_id": None,
            "item_id": None,
        }
    return {
        "rate": monetary(decimal_amount(facility.rate)),
        "currency": facility.currency,
        "source": "facility_rate_card",
        "card_id": None,
        "item_id": str(facility.id),
    }


@router.get("/services")
async def list_service_rates(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_rate_cards")
    services = (
        await session.execute(
            select(service_rates)
            .where(service_rates.c.organization_id == actor.organization_id)
            .order_by(service_rates.c.is_active.desc(), service_rates.c.name, service_rates.c.id)
        )
    ).all()
    return {"service_rates": [_service_response(service) for service in services]}


@router.get("/artist-roles")
async def list_artist_rate_roles(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Expose the tenant's editable role policy as selectable rate targets."""
    await require_permission(session, actor, "manage_rate_cards")
    rows = (
        await session.execute(
            select(organization_role_policies.c.role, organization_role_policies.c.label)
            .where(organization_role_policies.c.organization_id == actor.organization_id)
            .order_by(organization_role_policies.c.label, organization_role_policies.c.role)
        )
    ).all()
    return {"roles": [{"role": row.role, "label": row.label} for row in rows]}


@router.get("/master-rooms")
async def list_master_room_rates(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return Settings rooms with their optional master-card rate rows.

    A room is always selected from the operational room register.  The rate
    card never accepts a free-text room name, which keeps booking-rate
    resolution tied to the same room ID used by scheduling.
    """
    await require_permission(session, actor, "manage_rate_cards")
    master_card_ids = select(rate_cards.c.id).where(
        and_(
            rate_cards.c.organization_id == actor.organization_id,
            rate_cards.c.client_company_id.is_(None),
            rate_cards.c.network.is_(None),
            rate_cards.c.show_id.is_(None),
            rate_cards.c.episode_id.is_(None),
        )
    )
    rows = (
        await session.execute(
            select(
                rooms.c.id.label("room_id"),
                rooms.c.name.label("room_name"),
                rooms.c.type.label("room_type"),
                rate_card_items.c.id.label("item_id"),
                rate_card_items.c.category,
                rate_card_items.c.unit,
                rate_card_items.c.rate,
                rate_card_items.c.internal_cost_rate,
            )
            .select_from(rooms)
            .outerjoin(
                rate_card_items,
                and_(
                    rate_card_items.c.organization_id == actor.organization_id,
                    rate_card_items.c.target_type == "room",
                    rate_card_items.c.room_id == rooms.c.id,
                    rate_card_items.c.rate_card_id.in_(master_card_ids),
                ),
            )
            .where(rooms.c.organization_id == actor.organization_id)
            .order_by(rooms.c.name, rooms.c.id)
        )
    ).all()
    return {
        "rooms": [
            {
                "id": str(row.room_id),
                "name": row.room_name,
                "type": row.room_type,
                "rate": (
                    {
                        "id": str(row.item_id),
                        "category": row.category,
                        "unit": row.unit,
                        "rate": monetary(decimal_amount(row.rate)),
                        "internal_cost_rate": (
                            monetary(decimal_amount(row.internal_cost_rate))
                            if row.internal_cost_rate is not None
                            else None
                        ),
                        "currency": actor.active_organization.currency,
                    }
                    if row.item_id
                    else None
                ),
            }
            for row in rows
        ]
    }


@router.get("/room-rates")
async def list_scoped_room_rates(
    actor: CurrentActor,
    session: DbSession,
    scope: str,
    network: str | None = None,
    show_id: str | None = None,
    episode_id: str | None = None,
) -> dict[str, object]:
    """Return each Settings room with its own and inherited scoped price.

    Room rows use the same inheritance chain as booking price resolution.  A
    scoped card deliberately contains only exceptions; all other rooms remain
    visible here with the effective inherited rate so commercial users can see
    what a booking would use before creating an override.
    """
    await require_permission(session, actor, "manage_rate_cards")
    target = await _scope_target_from_query(
        session,
        actor,
        scope=scope,
        network=network,
        client_company_id=None,
        show_id=show_id,
        episode_id=episode_id,
    )

    show = None
    episode = None
    if scope == "show":
        show = (
            await session.execute(
                select(shows.c.id, shows.c.network, shows.c.client_company_id).where(
                    and_(shows.c.id == target["show_id"], shows.c.organization_id == actor.organization_id)
                )
            )
        ).first()
    elif scope == "episode":
        episode = await _episode_context(session, actor, str(target["episode_id"]))

    cards = [card for card in await _all_cards(session, actor) if card.is_active]
    items = await _items_for_cards(session, actor, [card.id for card in cards])

    def master(card: object) -> bool:
        return not card.client_company_id and not card.network and not card.show_id and not card.episode_id

    def network_card(card: object, value: str | None) -> bool:
        return bool(card.network == value and not card.client_company_id and not card.show_id and not card.episode_id)

    def show_card(card: object, value: object) -> bool:
        return bool(str(card.show_id or "") == str(value) and not card.episode_id)

    def client_card(card: object, value: object) -> bool:
        return bool(
            str(card.client_company_id or "") == str(value or "")
            and not card.network
            and not card.show_id
            and not card.episode_id
        )

    if scope == "master":
        own = [card for card in cards if master(card)]
        inherited_cards: list[object] = []
    elif scope == "network":
        own = [card for card in cards if network_card(card, str(target["network"]))]
        inherited_cards = [card for card in cards if master(card)]
    elif scope == "show":
        own = [card for card in cards if show_card(card, show.id)]
        inherited_cards = (
            [card for card in cards if network_card(card, show.network)]
            + [card for card in cards if client_card(card, show.client_company_id)]
            + [card for card in cards if master(card)]
        )
    else:
        own = [card for card in cards if str(card.episode_id or "") == str(episode.id)]
        inherited_cards = (
            [card for card in cards if show_card(card, episode.show_id)]
            + [card for card in cards if network_card(card, episode.network)]
            + [card for card in cards if client_card(card, episode.client_company_id)]
            + [card for card in cards if master(card)]
        )

    def room_item(card_list: list[object], room_id: object) -> tuple[object, object] | None:
        for card in card_list:
            match = next(
                (
                    item
                    for item in items.get(str(card.id), [])
                    if item.target_type == "room" and str(item.room_id) == str(room_id)
                ),
                None,
            )
            if match:
                return card, match
        return None

    def response_rate(result: tuple[object, object] | None) -> dict[str, object] | None:
        if not result:
            return None
        card, item = result
        return {
            "id": str(item.id),
            "category": item.category,
            "unit": item.unit,
            "rate": monetary(decimal_amount(item.rate)),
            "internal_cost_rate": (
                monetary(decimal_amount(item.internal_cost_rate)) if item.internal_cost_rate is not None else None
            ),
            "currency": card.currency,
            "source_scope": _scope_name(card),
        }

    room_rows = (
        await session.execute(
            select(rooms.c.id, rooms.c.name, rooms.c.type)
            .where(rooms.c.organization_id == actor.organization_id)
            .order_by(rooms.c.name, rooms.c.id)
        )
    ).all()
    return {
        "rooms": [
            {
                "id": str(room.id),
                "name": room.name,
                "type": room.type,
                "own_rate": response_rate(room_item(own, room.id)),
                "inherited_rate": response_rate(room_item(inherited_cards, room.id)),
            }
            for room in room_rows
        ]
    }


@router.post("/services", status_code=status.HTTP_201_CREATED)
async def create_service_rate(
    payload: ServiceRateCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_rate_cards")
    now = datetime.now(UTC)
    artist_role = await _artist_role_or_422(session, actor, payload.artist_role)
    try:
        created = await session.execute(
            insert(service_rates)
            .values(
                organization_id=actor.organization_id,
                name=payload.name.strip(),
                category=payload.category.strip(),
                artist_role=artist_role,
                unit=payload.unit.strip(),
                rate=payload.rate,
                currency=actor.active_organization.currency,
                notes=payload.notes.strip() if payload.notes else None,
                is_active=payload.is_active,
                created_at=now,
                updated_at=now,
            )
            .returning(service_rates)
        )
        service = created.first()
        await _audit(
            session,
            actor,
            action="service_rate.created",
            entity_type="service_rate",
            entity_id=str(service.id),
            metadata={
                "name": service.name,
                "category": service.category,
                "artistRole": service.artist_role,
                "unit": service.unit,
                "rate": str(service.rate),
                "currency": service.currency,
            },
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A service with that name already exists in this post house.",
        ) from error
    return _service_response(service)


@router.patch("/services/{service_rate_id}")
async def update_service_rate(
    service_rate_id: str, payload: ServiceRateUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_rate_cards")
    existing = await _service_or_404(session, actor, service_rate_id)
    fields = payload.model_fields_set
    values: dict[str, object] = {"updated_at": datetime.now(UTC)}
    for field in ("name", "category", "unit"):
        if field in fields:
            value = getattr(payload, field)
            values[field] = value.strip() if value else None
    if "artist_role" in fields:
        values["artist_role"] = await _artist_role_or_422(session, actor, payload.artist_role)
    for field in ("rate", "is_active"):
        if field in fields:
            values[field] = getattr(payload, field)
    if "notes" in fields:
        values["notes"] = payload.notes.strip() if payload.notes else None
    try:
        category = values.get("category", existing.category)
        unit = values.get("unit", existing.unit)
        artist_role = values.get("artist_role", existing.artist_role)
        if category != existing.category or unit != existing.unit or artist_role != existing.artist_role:
            await session.execute(
                update(rate_card_items)
                .where(
                    and_(
                        rate_card_items.c.organization_id == actor.organization_id,
                        rate_card_items.c.service_rate_id == service_rate_id,
                    )
                )
                .values(category=category, artist_role=artist_role, unit=unit, updated_at=datetime.now(UTC))
            )
        updated = await session.execute(
            update(service_rates)
            .where(
                and_(
                    service_rates.c.id == service_rate_id,
                    service_rates.c.organization_id == actor.organization_id,
                )
            )
            .values(**values)
            .returning(service_rates)
        )
        service = updated.first()
        await _audit(
            session,
            actor,
            action="service_rate.updated",
            entity_type="service_rate",
            entity_id=service_rate_id,
            metadata={
                "fields": sorted(fields),
                "before": {
                    "name": existing.name,
                    "category": existing.category,
                    "artistRole": existing.artist_role,
                    "unit": existing.unit,
                    "rate": str(existing.rate),
                },
                "after": {
                    "name": service.name,
                    "category": service.category,
                    "artistRole": service.artist_role,
                    "unit": service.unit,
                    "rate": str(service.rate),
                },
            },
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A service with that name already exists in this post house.",
        ) from error
    return _service_response(service)


@router.delete("/services/{service_rate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_service_rate(service_rate_id: str, actor: CurrentActor, session: DbSession) -> None:
    """Remove a catalogue service and every live rate-card entry that depends on it.

    Estimates retain their saved rate snapshots, so removing a service cannot rewrite
    historical commercial records.
    """
    await require_permission(session, actor, "manage_rate_cards")
    service = await _service_or_404(session, actor, service_rate_id)
    linked_items = (
        await session.execute(
            select(rate_card_items.c.id).where(
                and_(
                    rate_card_items.c.organization_id == actor.organization_id,
                    rate_card_items.c.service_rate_id == service_rate_id,
                )
            )
        )
    ).all()
    await session.execute(
        delete(rate_card_items).where(
            and_(
                rate_card_items.c.organization_id == actor.organization_id,
                rate_card_items.c.service_rate_id == service_rate_id,
            )
        )
    )
    await session.execute(
        delete(service_rates).where(
            and_(
                service_rates.c.id == service_rate_id,
                service_rates.c.organization_id == actor.organization_id,
            )
        )
    )
    await _audit(
        session,
        actor,
        action="service_rate.removed",
        entity_type="service_rate",
        entity_id=service_rate_id,
        metadata={
            "name": service.name,
            "category": service.category,
            "unit": service.unit,
            "rate": str(service.rate),
            "removedRateCardItems": len(linked_items),
        },
    )
    await session.commit()


@router.get("")
async def list_rate_cards(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_rate_cards")
    cards = await _all_cards(session, actor)
    items = await _items_for_cards(session, actor, [card.id for card in cards])
    return {"rate_cards": [_card_response(card, items.get(str(card.id), [])) for card in cards]}


@router.get("/artists")
async def search_rate_card_artists(
    actor: CurrentActor,
    session: DbSession,
    query: str = "",
) -> dict[str, object]:
    """Search active people in this post house for an explicit artist rate."""
    await require_permission(session, actor, "manage_rate_cards")
    term = query.strip()
    if not term:
        return {"people": []}
    pattern = f"%{term}%"
    rows = (
        await session.execute(
            select(people.c.id, people.c.name, people.c.role)
            .where(
                and_(
                    people.c.organization_id == actor.organization_id,
                    people.c.is_active.is_(True),
                    or_(people.c.name.ilike(pattern), people.c.role.ilike(pattern), people.c.email.ilike(pattern)),
                )
            )
            .order_by(people.c.name, people.c.id)
            .limit(12)
        )
    ).all()
    return {"people": [{"id": str(person.id), "name": person.name, "role": person.role} for person in rows]}


@router.get("/artist-rates")
async def list_artist_rates(
    actor: CurrentActor,
    session: DbSession,
    scope: str,
    network: str | None = None,
    client_company_id: str | None = None,
    show_id: str | None = None,
    episode_id: str | None = None,
) -> dict[str, object]:
    """Return explicit named-artist prices for one existing scoped card."""
    await require_permission(session, actor, "manage_rate_cards")
    target = await _scope_target_from_query(
        session,
        actor,
        scope=scope,
        network=network,
        client_company_id=client_company_id,
        show_id=show_id,
        episode_id=episode_id,
    )
    card = (
        await session.execute(
            select(rate_cards.c.id, rate_cards.c.currency)
            .where(and_(rate_cards.c.organization_id == actor.organization_id, *_scope_conditions(scope, target)))
            .order_by(rate_cards.c.created_at.desc(), rate_cards.c.id)
            .limit(1)
        )
    ).first()
    if not card:
        return {"artist_rates": []}
    rows = (
        await session.execute(
            select(
                rate_card_items.c.id,
                rate_card_items.c.person_id,
                rate_card_items.c.category,
                rate_card_items.c.unit,
                rate_card_items.c.rate,
                rate_card_items.c.internal_cost_rate,
                people.c.name.label("person_name"),
                people.c.role.label("person_role"),
            )
            .select_from(rate_card_items)
            .join(
                people,
                and_(people.c.id == rate_card_items.c.person_id, people.c.organization_id == actor.organization_id),
            )
            .where(
                and_(
                    rate_card_items.c.organization_id == actor.organization_id,
                    rate_card_items.c.rate_card_id == card.id,
                    rate_card_items.c.target_type == "person",
                )
            )
            .order_by(people.c.name, rate_card_items.c.id)
        )
    ).all()
    return {
        "artist_rates": [
            {
                "id": str(item.id),
                "person": {"id": str(item.person_id), "name": item.person_name, "role": item.person_role},
                "category": item.category,
                "unit": item.unit,
                "client_rate": monetary(decimal_amount(item.rate)),
                "internal_cost_rate": (
                    monetary(decimal_amount(item.internal_cost_rate)) if item.internal_cost_rate is not None else None
                ),
                "currency": card.currency,
            }
            for item in rows
        ]
    }


@router.post("/overrides", status_code=status.HTTP_201_CREATED)
async def set_rate_card_override(
    payload: RateCardOverrideRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_rate_cards")
    target, name = await _scope_target(session, actor, payload)
    item_target = await _item_target(session, actor, payload)
    service = await _service_or_404(session, actor, payload.service_rate_id) if payload.service_rate_id else None
    if service and (
        (payload.category and payload.category.strip() != service.category)
        or (payload.unit and payload.unit.strip() != service.unit)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The override category and unit must match the selected service rate.",
        )
    category = service.category if service else (payload.category or "").strip()
    artist_role = service.artist_role if service else None
    unit = service.unit if service else (payload.unit or "").strip()
    try:
        card = await _card_for_scope(session, actor, scope=payload.scope, target=target, name=name)
        now = datetime.now(UTC)
        values = {
            "organization_id": actor.organization_id,
            "rate_card_id": card.id,
            "service_rate_id": service.id if service else None,
            **item_target,
            "category": category,
            "artist_role": artist_role,
            "unit": unit,
            "rate": payload.rate,
            "internal_cost_rate": payload.internal_cost_rate,
            "created_at": now,
            "updated_at": now,
        }
        if payload.target_type == "service":
            identity = and_(
                rate_card_items.c.rate_card_id == card.id,
                rate_card_items.c.target_type == "service",
                rate_card_items.c.category == category,
                rate_card_items.c.unit == unit,
            )
        elif payload.target_type == "room":
            identity = and_(
                rate_card_items.c.rate_card_id == card.id,
                rate_card_items.c.target_type == "room",
                rate_card_items.c.room_id == item_target["room_id"],
            )
        else:
            identity = and_(
                rate_card_items.c.rate_card_id == card.id,
                rate_card_items.c.target_type == "person",
                rate_card_items.c.person_id == item_target["person_id"],
            )
        existing = (await session.execute(select(rate_card_items.c.id).where(identity).limit(1))).first()
        if existing:
            await session.execute(
                update(rate_card_items)
                .where(
                    and_(
                        rate_card_items.c.id == existing.id,
                        rate_card_items.c.organization_id == actor.organization_id,
                    )
                )
                .values(
                    **{
                        key: value
                        for key, value in values.items()
                        if key not in {"organization_id", "rate_card_id", "created_at"}
                    }
                )
            )
        else:
            await session.execute(insert(rate_card_items).values(**values))
        await _audit(
            session,
            actor,
            action="rate_card.override_set",
            entity_type="rate_card",
            entity_id=str(card.id),
            metadata={
                "scope": payload.scope,
                "targetType": payload.target_type,
                "category": category,
                "artistRole": artist_role,
                "unit": unit,
                "rate": payload.rate,
                "internalCostRate": payload.internal_cost_rate,
                "roomId": str(item_target["room_id"]) if item_target["room_id"] else None,
                "personId": str(item_target["person_id"]) if item_target["person_id"] else None,
            },
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The rate-card override could not be saved.",
        ) from error
    items = await _items_for_cards(session, actor, [card.id])
    return _card_response(card, items.get(str(card.id), []))


@router.get("/overrides")
async def get_rate_card_overrides(
    actor: CurrentActor,
    session: DbSession,
    scope: str,
    network: str | None = None,
    show_id: str | None = None,
    episode_id: str | None = None,
) -> dict[str, object]:
    """Return own and inherited rates for a rate-card scope."""
    await require_permission(session, actor, "manage_rate_cards")
    if scope not in {"master", "network", "show", "episode"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid rate-card scope.")
    if scope == "network" and not network:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a network rate-card scope.")
    if scope == "show" and not show_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a show rate-card scope.")
    if scope == "episode" and not episode_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose an episode rate-card scope.")

    show = None
    episode = None
    if scope == "show":
        show = (
            await session.execute(
                select(shows.c.id, shows.c.network, shows.c.client_company_id).where(
                    and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not show:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    elif scope == "episode":
        episode = await _episode_context(session, actor, episode_id or "")

    cards = [card for card in await _all_cards(session, actor) if card.is_active]
    items = await _items_for_cards(session, actor, [card.id for card in cards])

    # SQL expressions cannot be evaluated against result rows. Reuse explicit
    # predicates here; every card was already tenant-scoped by _all_cards.
    def master(card: object) -> bool:
        return not card.client_company_id and not card.network and not card.show_id and not card.episode_id

    def network_card(card: object, value: str | None) -> bool:
        return bool(card.network == value and not card.client_company_id and not card.show_id and not card.episode_id)

    def show_card(card: object, value: object) -> bool:
        return bool(str(card.show_id or "") == str(value) and not card.episode_id)

    def client_card(card: object, value: object) -> bool:
        return bool(
            str(card.client_company_id or "") == str(value or "")
            and not card.network
            and not card.show_id
            and not card.episode_id
        )

    if scope == "master":
        own = [card for card in cards if master(card)]
        chain = own
    elif scope == "network":
        own = [card for card in cards if network_card(card, network)]
        chain = own + [card for card in cards if master(card)]
    elif scope == "show":
        own = [card for card in cards if show_card(card, show.id)]
        chain = (
            own
            + [card for card in cards if network_card(card, show.network)]
            + [card for card in cards if client_card(card, show.client_company_id)]
            + [card for card in cards if master(card)]
        )
    else:
        own = [card for card in cards if str(card.episode_id or "") == str(episode.id)]
        chain = (
            own
            + [card for card in cards if show_card(card, episode.show_id)]
            + [card for card in cards if network_card(card, episode.network)]
            + [card for card in cards if client_card(card, episode.client_company_id)]
            + [card for card in cards if master(card)]
        )
    inherited: dict[str, object] = {}
    overrides: dict[str, object] = {}
    own_ids = {str(card.id) for card in own}
    for card in chain:
        for item in items.get(str(card.id), []):
            if item.target_type != "service":
                continue
            key = f"{item.category}:{item.unit}"
            if key not in inherited:
                value = {"rate": monetary(decimal_amount(item.rate)), "currency": card.currency, "source": str(card.id)}
                inherited[key] = value
                if str(card.id) in own_ids:
                    overrides[key] = {"rate": value["rate"], "currency": card.currency}
    return {"overrides": overrides, "inherited": inherited}


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_rate_card_override(item_id: str, actor: CurrentActor, session: DbSession) -> None:
    """Remove one narrow override so the next inherited rate takes effect."""
    await require_permission(session, actor, "manage_rate_cards")
    item = (
        await session.execute(
            select(
                rate_card_items.c.id, rate_card_items.c.rate_card_id, rate_card_items.c.category, rate_card_items.c.unit
            )
            .join(rate_cards, rate_cards.c.id == rate_card_items.c.rate_card_id)
            .where(
                and_(
                    rate_card_items.c.id == item_id,
                    rate_card_items.c.organization_id == actor.organization_id,
                    rate_cards.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rate-card override not found.")
    await session.execute(
        delete(rate_card_items).where(
            and_(rate_card_items.c.id == item_id, rate_card_items.c.organization_id == actor.organization_id)
        )
    )
    await _audit(
        session,
        actor,
        action="rate_card.override_removed",
        entity_type="rate_card",
        entity_id=str(item.rate_card_id),
        metadata={"itemId": item_id, "category": item.category, "unit": item.unit},
    )
    await session.commit()


@router.get("/effective")
async def get_effective_rate(
    episode_id: str,
    category: str,
    unit: str,
    actor: CurrentActor,
    session: DbSession,
    target_type: str | None = None,
    target_id: str | None = None,
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    return {
        "episode_id": episode_id,
        "category": category,
        "unit": unit,
        "target_type": target_type,
        "target_id": target_id,
        "effective_rate": await resolve_effective_rate(
            session,
            actor,
            episode_id=episode_id,
            category=category,
            unit=unit,
            target_type=target_type,
            target_id=target_id,
        ),
    }
