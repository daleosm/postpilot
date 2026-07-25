"""Tenant-owned service catalogue and inherited master-to-episode rate cards."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    RateCardOverrideRequest,
    ServiceRateCreateRequest,
    ServiceRateUpdateRequest,
)
from app.auth import require_permission
from app.budget_logic import decimal_amount, monetary
from app.db.tables import (
    activity_log,
    crm_companies,
    episodes,
    rate_card_items,
    rate_cards,
    seasons,
    service_rates,
    shows,
)
from app.rate_card_logic import RATE_CARD_PRECEDENCE, RateCandidate, choose_effective_rate

router = APIRouter(prefix="/rate-cards", tags=["rate-cards"])


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
                "category": item.category,
                "unit": item.unit,
                "rate": monetary(decimal_amount(item.rate)),
            }
            for item in items
        ],
    }


def _service_response(service: object) -> dict[str, object]:
    return {
        "id": str(service.id),
        "name": service.name,
        "category": service.category,
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
            metadata=metadata,
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


async def _effective_rate(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode_id: str,
    category: str,
    unit: str,
) -> dict[str, object]:
    episode = await _episode_context(session, actor, episode_id)
    cards = [card for card in await _all_cards(session, actor) if card.is_active]
    card_ids = [card.id for card in cards]
    items = await _items_for_cards(session, actor, card_ids)
    candidates: list[RateCandidate] = []
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
    for source in RATE_CARD_PRECEDENCE:
        for card in cards:
            if not source_filters[source](card):
                continue
            item = next(
                (entry for entry in items.get(str(card.id), []) if entry.category == category and entry.unit == unit),
                None,
            )
            if item:
                candidates.append(
                    RateCandidate(
                        source=source,
                        rate=decimal_amount(item.rate),
                        currency=card.currency,
                        card_id=str(card.id),
                        item_id=str(item.id),
                    )
                )
    candidate = choose_effective_rate(candidates)
    if candidate:
        return {
            "rate": monetary(candidate.rate),
            "currency": candidate.currency,
            "source": candidate.source,
            "card_id": candidate.card_id,
            "item_id": candidate.item_id,
        }
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
    await require_permission(session, actor, "manage_commercial")
    services = (
        await session.execute(
            select(service_rates)
            .where(service_rates.c.organization_id == actor.organization_id)
            .order_by(service_rates.c.is_active.desc(), service_rates.c.name, service_rates.c.id)
        )
    ).all()
    return {"service_rates": [_service_response(service) for service in services]}


@router.post("/services", status_code=status.HTTP_201_CREATED)
async def create_service_rate(
    payload: ServiceRateCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    now = datetime.now(UTC)
    try:
        created = await session.execute(
            insert(service_rates)
            .values(
                organization_id=actor.organization_id,
                name=payload.name.strip(),
                category=payload.category.strip(),
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
            metadata={"category": service.category, "unit": service.unit},
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
    await require_permission(session, actor, "manage_commercial")
    await _service_or_404(session, actor, service_rate_id)
    fields = payload.model_fields_set
    values: dict[str, object] = {"updated_at": datetime.now(UTC)}
    for field in ("name", "category", "unit"):
        if field in fields:
            value = getattr(payload, field)
            values[field] = value.strip() if value else None
    for field in ("rate", "is_active"):
        if field in fields:
            values[field] = getattr(payload, field)
    if "notes" in fields:
        values["notes"] = payload.notes.strip() if payload.notes else None
    try:
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
            metadata={"fields": sorted(fields)},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A service with that name already exists in this post house.",
        ) from error
    return _service_response(service)


@router.get("")
async def list_rate_cards(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    cards = await _all_cards(session, actor)
    items = await _items_for_cards(session, actor, [card.id for card in cards])
    return {"rate_cards": [_card_response(card, items.get(str(card.id), [])) for card in cards]}


@router.post("/overrides", status_code=status.HTTP_201_CREATED)
async def set_rate_card_override(
    payload: RateCardOverrideRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    target, name = await _scope_target(session, actor, payload)
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
    unit = service.unit if service else (payload.unit or "").strip()
    try:
        card = await _card_for_scope(session, actor, scope=payload.scope, target=target, name=name)
        now = datetime.now(UTC)
        item_statement = pg_insert(rate_card_items).values(
            organization_id=actor.organization_id,
            rate_card_id=card.id,
            service_rate_id=service.id if service else None,
            category=category,
            unit=unit,
            rate=payload.rate,
            created_at=now,
            updated_at=now,
        )
        await session.execute(
            item_statement.on_conflict_do_update(
                index_elements=[rate_card_items.c.rate_card_id, rate_card_items.c.category, rate_card_items.c.unit],
                set_={
                    "service_rate_id": service.id if service else None,
                    "rate": payload.rate,
                    "updated_at": now,
                },
            )
        )
        await _audit(
            session,
            actor,
            action="rate_card.override_set",
            entity_type="rate_card",
            entity_id=str(card.id),
            metadata={"scope": payload.scope, "category": category, "unit": unit, "rate": payload.rate},
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
    await require_permission(session, actor, "manage_commercial")
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
    await require_permission(session, actor, "manage_commercial")
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
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    return {
        "episode_id": episode_id,
        "category": category,
        "unit": unit,
        "effective_rate": await _effective_rate(
            session,
            actor,
            episode_id=episode_id,
            category=category,
            unit=unit,
        ),
    }
