"""Tenant-scoped facility bookings backed by the shared operational rules."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, case, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import may_view_all_episodes
from app.api.schemas import (
    BookingConflictFlagRequest,
    BookingConflictRequest,
    BookingCreateRequest,
    BookingGuestAccountRequest,
    BookingTimeSubmissionRequest,
    CopyEpisodeBookingsRequest,
)
from app.auth import has_permission, require_permission
from app.booking_costs import BOOKING_RATE_DEFINITIONS, confirmed_hours, cost_for_hours
from app.booking_logic import booking_conflicts, is_active_option, nearest_free_slot, resequence_options
from app.budget_actuals import record_budget_actual
from app.db.tables import (
    activity_log,
    bookings,
    budget_lines,
    episode_team_assignments,
    episodes,
    organization_members,
    people,
    post_work_orders,
    rate_card_items,
    rate_cards,
    rooms,
    seasons,
    service_rates,
    shows,
    users,
    workflow_stages,
)

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _decimal(value: object | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def _booking_values(row: object, *, include_commercial_context: bool = False) -> dict[str, object]:
    value = {
        "id": row.id,
        "room_id": row.room_id,
        "episode_id": row.episode_id,
        "budget_line_id": str(row.budget_line_id) if row.budget_line_id else None,
        "person_id": row.person_id,
        "guest_person_id": row.guest_person_id,
        "title": row.title,
        "starts_at": row.starts_at,
        "ends_at": row.ends_at,
        "setup_minutes": row.setup_minutes,
        "handover_minutes": row.handover_minutes,
        "actual_starts_at": row.actual_starts_at,
        "actual_ends_at": row.actual_ends_at,
        "approved_overtime_minutes": row.approved_overtime_minutes,
        "is_option": row.is_option,
        "option_rank": row.option_rank,
        "status": row.status,
        "booking_type": row.booking_type,
        "notes": row.notes,
        "room_name": getattr(row, "room_name", None),
        "room_type": getattr(row, "room_type", None),
        "episode_title": getattr(row, "episode_title", None),
        "episode_number": getattr(row, "episode_number", None),
        "episode_production_code": getattr(row, "episode_production_code", None),
        "person_name": getattr(row, "person_name", None),
        # A linked work order is the authoritative source for a calendar
        # reservation. It is deliberately not inferred from the booking title.
        "work_order_id": getattr(row, "work_order_id", None),
        "actual_budget_status": getattr(row, "actual_budget_status", None),
        "budget_item_label": getattr(row, "budget_item_label", None),
        "workflow_state": (
            {
                "primary_stage_id": str(getattr(row, "workflow_stage_id", "")) or None,
                "primary_stage_name": getattr(row, "workflow_stage_name", None),
                "display_status": getattr(row, "workflow_status", None),
            }
            if getattr(row, "episode_id", None)
        else None
        ),
    }
    if getattr(row, "budget_line_id", None) and getattr(row, "budget_item_label", None):
        value["budget_item"] = {
            "id": str(row.budget_line_id),
            "label": getattr(row, "budget_item_label"),
        }
    else:
        value["budget_item"] = None
    if include_commercial_context and getattr(row, "budget_line_id", None):
        estimated = _decimal(getattr(row, "budget_item_estimated_amount", None))
        actual = _decimal(getattr(row, "budget_item_actual_amount", None))
        if estimated is not None and actual is not None:
            value["budget_item_context"] = {
                "estimated_amount": _money(estimated),
                "actual_amount": _money(actual),
                "remaining_estimate": _money(max(Decimal(0), estimated - actual)),
                "currency": getattr(row, "budget_item_currency", None),
            }
    return value


def _window(payload: BookingCreateRequest) -> dict[str, object]:
    return {
        "room_id": payload.room_id,
        "person_id": payload.person_id,
        "starts_at": payload.starts_at,
        "ends_at": payload.ends_at,
        "setup_minutes": payload.setup_minutes,
        "handover_minutes": payload.handover_minutes,
        "status": payload.status,
        "is_option": payload.is_option,
    }


def _payload_from_booking(row: object) -> BookingCreateRequest:
    return BookingCreateRequest(
        title=row.title,
        room_id=row.room_id,
        episode_id=row.episode_id,
        budget_line_id=row.budget_line_id,
        person_id=row.person_id,
        guest_person_id=row.guest_person_id,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        setup_minutes=row.setup_minutes,
        handover_minutes=row.handover_minutes,
        status=row.status,
        booking_type=row.booking_type,
        is_option=row.is_option,
        notes=row.notes,
    )


async def _resolve_room_rate(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode_id: str | None,
    booking_type: str,
) -> dict[str, object] | None:
    """Resolve the live inherited room/service rate for one booking type."""
    definition = BOOKING_RATE_DEFINITIONS.get(booking_type)
    if not definition:
        return None
    category, unit = definition
    episode_scope = None
    if episode_id:
        episode_scope = (
            await session.execute(
                select(shows.c.id.label("show_id"), shows.c.client_company_id, shows.c.network)
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
        if not episode_scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")

    cards = (
        await session.execute(
            select(
                rate_cards.c.id,
                rate_cards.c.currency,
                rate_cards.c.client_company_id,
                rate_cards.c.network,
                rate_cards.c.show_id,
                rate_cards.c.episode_id,
            ).where(and_(rate_cards.c.organization_id == actor.organization_id, rate_cards.c.is_active.is_(True)))
        )
    ).all()
    ordered: list[tuple[object, str]] = []
    if episode_scope:
        ordered.extend((card, "episode_rate_card") for card in cards if str(card.episode_id or "") == episode_id)
        ordered.extend(
            (card, "show_rate_card")
            for card in cards
            if card.show_id and str(card.show_id) == str(episode_scope.show_id) and not card.episode_id
        )
        ordered.extend(
            (card, "network_rate_card")
            for card in cards
            if card.network and card.network == episode_scope.network and not card.show_id and not card.episode_id
        )
        ordered.extend(
            (card, "client_rate_card")
            for card in cards
            if card.client_company_id
            and str(card.client_company_id) == str(episode_scope.client_company_id or "")
            and not card.network
            and not card.show_id
            and not card.episode_id
        )
    ordered.extend(
        (card, "master_rate_card")
        for card in cards
        if not card.client_company_id and not card.network and not card.show_id and not card.episode_id
    )
    for card, source in ordered:
        item = (
            await session.execute(
                select(rate_card_items.c.id, rate_card_items.c.rate)
                .where(
                    and_(
                        rate_card_items.c.organization_id == actor.organization_id,
                        rate_card_items.c.rate_card_id == card.id,
                        rate_card_items.c.category == category,
                        rate_card_items.c.unit == unit,
                    )
                )
                .limit(1)
            )
        ).first()
        if item:
            return {
                "category": category,
                "unit": unit,
                "rate": _decimal(item.rate),
                "currency": card.currency,
                "source": source,
                "rate_card_id": str(card.id),
            }
    facility = (
        await session.execute(
            select(service_rates.c.id, service_rates.c.rate, service_rates.c.currency)
            .where(
                and_(
                    service_rates.c.organization_id == actor.organization_id,
                    service_rates.c.category == category,
                    service_rates.c.unit == unit,
                    service_rates.c.is_active.is_(True),
                )
            )
            .limit(1)
        )
    ).first()
    if not facility:
        return None
    return {
        "category": category,
        "unit": unit,
        "rate": _decimal(facility.rate),
        "currency": facility.currency,
        "source": "facility_rate_card",
        "rate_card_id": None,
    }


def _person_rate(person: object, currency: str) -> dict[str, object] | None:
    hourly = _decimal(person.hourly_rate)
    if hourly is not None:
        return {"unit": "hour", "rate": hourly, "currency": currency, "source": "person_hourly_rate"}
    daily = _decimal(person.day_rate)
    if daily is not None:
        return {"unit": "day", "rate": daily, "currency": currency, "source": "person_day_rate"}
    return None


async def _actual_cost(
    session: DbSession,
    actor: CurrentActor,
    *,
    booking: object,
    actual_starts_at: datetime,
    actual_ends_at: datetime,
    overtime_minutes: int,
) -> dict[str, object]:
    """Calculate internal cost from tenant records, never client input."""
    actual_hours = confirmed_hours(actual_starts_at, actual_ends_at, overtime_minutes)
    room_rate = await _resolve_room_rate(
        session,
        actor,
        episode_id=str(booking.episode_id) if booking.episode_id else None,
        booking_type=booking.booking_type,
    )
    person = None
    if booking.person_id:
        person = (
            await session.execute(
                select(people.c.id, people.c.name, people.c.hourly_rate, people.c.day_rate).where(
                    and_(people.c.id == booking.person_id, people.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not person:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned person not found.")
    artist_rate = _person_rate(person, actor.active_organization.currency) if person else None
    room_cost = cost_for_hours(room_rate["rate"], room_rate["unit"], actual_hours) if room_rate else Decimal(0)
    artist_cost = cost_for_hours(artist_rate["rate"], artist_rate["unit"], actual_hours) if artist_rate else Decimal(0)
    total = room_cost + artist_cost
    return {
        "actual_hours": _money(actual_hours),
        "overtime_minutes": overtime_minutes,
        "currency": (room_rate or artist_rate or {"currency": actor.active_organization.currency})["currency"],
        "room": {
            "category": room_rate["category"],
            "rate": _money(room_rate["rate"]),
            "unit": room_rate["unit"],
            "source": room_rate["source"],
            "cost": _money(room_cost),
        }
        if room_rate
        else None,
        "artist": {
            "person_id": str(person.id),
            "name": person.name,
            "rate": _money(artist_rate["rate"]),
            "unit": artist_rate["unit"],
            "source": artist_rate["source"],
            "cost": _money(artist_cost),
        }
        if person and artist_rate
        else None,
        "total_internal_cost": _money(total),
    }


async def _tenant_reference_exists(session: DbSession, table, organization_id: str, record_id: str | None) -> bool:
    if not record_id:
        return True
    return bool(
        (
            await session.execute(
                select(table.c.id)
                .where(and_(table.c.id == record_id, table.c.organization_id == organization_id))
                .limit(1)
            )
        ).first()
    )


async def _validate_references(session: DbSession, actor: CurrentActor, payload: BookingCreateRequest) -> None:
    resources = (
        ("room", rooms, payload.room_id),
        ("episode", episodes, payload.episode_id),
        ("person", people, payload.person_id),
        ("guest account", people, payload.guest_person_id),
    )
    invalid = [
        label
        for label, table, record_id in resources
        if not await _tenant_reference_exists(session, table, actor.organization_id, record_id)
    ]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invalid {', '.join(invalid)} for this post house.",
        )
    if payload.guest_person_id:
        guest = (
            await session.execute(
                select(people.c.id).where(
                    and_(
                        people.c.id == payload.guest_person_id,
                        people.c.organization_id == actor.organization_id,
                        people.c.role == "client",
                    )
                )
            )
        ).first()
        if not guest:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Client account not found for this post house."
            )
    if payload.budget_line_id:
        item = (
            await session.execute(
                select(
                    budget_lines.c.id,
                    budget_lines.c.episode_id,
                    budget_lines.c.external_cost,
                ).where(
                    and_(
                        budget_lines.c.id == payload.budget_line_id,
                        budget_lines.c.organization_id == actor.organization_id,
                    )
                ).limit(1)
            )
        ).first()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget item not found.")
        if item.external_cost:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An external-cost budget item cannot be used by an internal booking.",
            )
        if not payload.episode_id or str(item.episode_id or "") != payload.episode_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The selected budget item must belong to this booking's episode.",
            )


async def _booking_budget_item(session: DbSession, actor: CurrentActor, booking: object) -> object | None:
    """Return the saved estimate item selected for this booking, if any."""
    if not booking.budget_line_id:
        return None
    item = (
        await session.execute(
            select(
                budget_lines.c.id,
                budget_lines.c.episode_id,
                budget_lines.c.category,
                budget_lines.c.description,
                budget_lines.c.rate_snapshot,
                budget_lines.c.planned_unit,
                budget_lines.c.currency,
                budget_lines.c.external_cost,
            ).where(
                and_(
                    budget_lines.c.id == booking.budget_line_id,
                    budget_lines.c.organization_id == actor.organization_id,
                )
            ).limit(1)
        )
    ).first()
    if not item or item.external_cost or str(item.episode_id or "") != str(booking.episode_id or ""):
        # Database guards prevent this in normal operation. Treat a stale
        # historic relation as unallocated rather than accidentally posting a
        # cost to a different episode.
        return None
    return item


async def _booking_actual_allocation(
    session: DbSession,
    actor: CurrentActor,
    *,
    booking: object,
    actual_hours: Decimal,
) -> dict[str, object]:
    """Calculate the budget actual exclusively from the saved estimate rate."""
    item = await _booking_budget_item(session, actor, booking)
    if not item:
        return {"status": "unallocated", "reason": "No episode budget item was selected for this booking."}
    if item.rate_snapshot is None or not item.planned_unit:
        return {
            "status": "unallocated",
            "reason": "The selected budget item has no saved rate snapshot.",
            "budget_line_id": str(item.id),
            "budget_item_label": item.description or item.category,
        }
    amount = cost_for_hours(_decimal(item.rate_snapshot), item.planned_unit, actual_hours)
    return {
        "status": "allocated",
        "budget_line_id": str(item.id),
        "budget_item_label": item.description or item.category,
        "rate": _money(_decimal(item.rate_snapshot) or Decimal(0)),
        "unit": item.planned_unit,
        "amount": _money(amount),
        "amount_decimal": amount,
        "currency": item.currency,
    }


async def _add_booking_client_to_episode_team(
    session: DbSession, actor: CurrentActor, payload: BookingCreateRequest
) -> None:
    if not payload.episode_id or not payload.guest_person_id:
        return
    await session.execute(
        pg_insert(episode_team_assignments)
        .values(
            organization_id=actor.organization_id,
            episode_id=payload.episode_id,
            person_id=payload.guest_person_id,
            is_lead=False,
        )
        .on_conflict_do_nothing(index_elements=["episode_id", "person_id"])
    )


async def _existing_resource_bookings(
    session: DbSession,
    actor: CurrentActor,
    payload: BookingCreateRequest,
    *,
    include_options: bool,
    exclude_booking_id: str | None = None,
) -> list[dict[str, object]]:
    resources = []
    if payload.room_id:
        resources.append(bookings.c.room_id == payload.room_id)
    if payload.person_id:
        resources.append(bookings.c.person_id == payload.person_id)
    if not resources:
        return []
    conditions = [
        bookings.c.organization_id == actor.organization_id,
        bookings.c.status != "cancelled",
        or_(*resources),
    ]
    if not include_options:
        conditions.append(bookings.c.is_option.is_(False))
    if exclude_booking_id:
        conditions.append(bookings.c.id != exclude_booking_id)
    result = await session.execute(
        select(bookings).where(and_(*conditions)).order_by(bookings.c.starts_at, bookings.c.id)
    )
    return [dict(row._mapping) for row in result]


async def _resequence_active_options(session: DbSession, actor: CurrentActor, payload: BookingCreateRequest) -> None:
    """Maintain first-come option rank among the overlapping room/person holds."""
    candidates = await _existing_resource_bookings(session, actor, payload, include_options=True)
    overlapping = booking_conflicts(candidates, _window(payload), include_options=True)
    # ``booking_conflicts`` enriches each candidate with an ``overlaps`` key,
    # so dict-equality against the original rows is never true. Compare stable
    # identifiers instead; otherwise every new pencil hold retains its default
    # rank of one.
    overlapping_ids = {str(item["id"]) for item in overlapping}
    current = [
        item
        for item in candidates
        if item["is_option"] and item["status"] != "cancelled" and str(item["id"]) in overlapping_ids
    ]
    ranks = resequence_options(current)
    for booking_id, rank in ranks.items():
        await session.execute(
            update(bookings)
            .where(and_(bookings.c.id == booking_id, bookings.c.organization_id == actor.organization_id))
            .values(option_rank=rank, updated_at=datetime.now(UTC))
        )


async def _availability(
    session: DbSession,
    actor: CurrentActor,
    payload: BookingCreateRequest,
    *,
    exclude_booking_id: str | None = None,
) -> dict[str, object]:
    existing = await _existing_resource_bookings(
        session,
        actor,
        payload,
        include_options=payload.is_option,
        exclude_booking_id=exclude_booking_id,
    )
    conflicts = booking_conflicts(
        existing,
        _window(payload),
        include_options=payload.is_option,
        exclude_id=exclude_booking_id,
    )
    return {
        "conflicts": [
            {
                "id": item["id"],
                "title": item["title"],
                "starts_at": item["starts_at"],
                "ends_at": item["ends_at"],
                "room_id": item["room_id"],
                "person_id": item["person_id"],
                "overlaps": item["overlaps"],
            }
            for item in conflicts
        ],
        "nearest_slot": nearest_free_slot(_window(payload), existing),
    }


@router.get("")
async def list_bookings(
    actor: CurrentActor,
    session: DbSession,
    from_at: datetime | None = None,
    to_at: datetime | None = None,
) -> dict[str, object]:
    can_view_commercial = await has_permission(session, actor, "manage_commercial")
    conditions = [bookings.c.organization_id == actor.organization_id]
    if not await may_view_all_episodes(session, actor):
        if not actor.person_id:
            conditions.append(bookings.c.id.is_(None))
        elif actor.active_organization and actor.active_organization.role == "client":
            # External attendees see only the review bookings explicitly tied
            # to their own client account—never the whole facility calendar.
            conditions.append(
                or_(bookings.c.person_id == actor.person_id, bookings.c.guest_person_id == actor.person_id)
            )
        else:
            conditions.append(bookings.c.person_id == actor.person_id)
    if from_at:
        conditions.append(bookings.c.ends_at > from_at)
    if to_at:
        conditions.append(bookings.c.starts_at < to_at)
    result = await session.execute(
        select(
            bookings,
            rooms.c.name.label("room_name"),
            rooms.c.type.label("room_type"),
            episodes.c.title.label("episode_title"),
            episodes.c.number.label("episode_number"),
            episodes.c.production_code.label("episode_production_code"),
            episodes.c.workflow_stage_id,
            episodes.c.workflow_status,
            workflow_stages.c.name.label("workflow_stage_name"),
            people.c.name.label("person_name"),
            post_work_orders.c.id.label("work_order_id"),
            func.coalesce(budget_lines.c.description, budget_lines.c.category).label("budget_item_label"),
            budget_lines.c.budgeted_amount.label("budget_item_estimated_amount"),
            budget_lines.c.actual_amount.label("budget_item_actual_amount"),
            budget_lines.c.currency.label("budget_item_currency"),
            case(
                (
                    and_(
                        bookings.c.actual_starts_at.is_not(None),
                        bookings.c.actual_ends_at.is_not(None),
                        or_(bookings.c.budget_line_id.is_(None), budget_lines.c.rate_snapshot.is_(None)),
                    ),
                    "unallocated",
                ),
                (
                    and_(
                        bookings.c.actual_starts_at.is_not(None),
                        bookings.c.actual_ends_at.is_not(None),
                    ),
                    "allocated",
                ),
                else_="not_submitted",
            ).label("actual_budget_status"),
        )
        .select_from(bookings)
        .outerjoin(
            rooms,
            and_(rooms.c.id == bookings.c.room_id, rooms.c.organization_id == actor.organization_id),
        )
        .outerjoin(
            episodes,
            and_(episodes.c.id == bookings.c.episode_id, episodes.c.organization_id == actor.organization_id),
        )
        .outerjoin(
            workflow_stages,
            and_(
                workflow_stages.c.id == episodes.c.workflow_stage_id,
                workflow_stages.c.organization_id == actor.organization_id,
            ),
        )
        .outerjoin(
            people,
            and_(people.c.id == bookings.c.person_id, people.c.organization_id == actor.organization_id),
        )
        .outerjoin(
            post_work_orders,
            and_(
                post_work_orders.c.booking_id == bookings.c.id,
                post_work_orders.c.organization_id == actor.organization_id,
            ),
        )
        .outerjoin(
            budget_lines,
            and_(
                budget_lines.c.id == bookings.c.budget_line_id,
                budget_lines.c.organization_id == actor.organization_id,
            ),
        )
        .where(and_(*conditions))
        .order_by(bookings.c.starts_at, bookings.c.id)
    )
    room_rows = await session.execute(
        select(rooms.c.id, rooms.c.name, rooms.c.type)
        .where(rooms.c.organization_id == actor.organization_id)
        .order_by(rooms.c.name, rooms.c.id)
    )
    return {
        "bookings": [_booking_values(row, include_commercial_context=can_view_commercial) for row in result],
        "rooms": [{"id": room.id, "name": room.name, "type": room.type} for room in room_rows],
    }


@router.get("/resources")
async def booking_resources(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Read the tenant-safe reference data used by the bookings board."""
    # ``actor.permissions`` contains compressed capabilities, whereas these
    # endpoints historically named legacy aliases. Resolve them centrally so
    # an artist with ``do_assigned_work`` may read their own booking board.
    may_access_board = any(
        [
            await has_permission(session, actor, "manage_bookings"),
            await has_permission(session, actor, "view_all_operations"),
            await has_permission(session, actor, "update_assigned_work"),
        ]
    )
    if not may_access_board:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access the bookings board.")
    may_view_all = await may_view_all_episodes(session, actor)
    room_rows = await session.execute(
        select(rooms.c.id, rooms.c.name, rooms.c.type)
        .where(rooms.c.organization_id == actor.organization_id)
        .order_by(rooms.c.name, rooms.c.id)
    )
    person_conditions = [people.c.organization_id == actor.organization_id, people.c.is_active.is_(True)]
    if not may_view_all:
        # The board is available to assigned artists for reserving their own
        # work, but it must not expose the post house's full people directory.
        person_conditions.append(people.c.id == actor.person_id if actor.person_id else people.c.id.is_(None))
    person_rows = await session.execute(
        select(
            people.c.id,
            people.c.name,
            people.c.email,
            people.c.company,
            people.c.role,
            people.c.availability,
            people.c.is_freelancer,
            people.c.hourly_rate,
            organization_members.c.role.label("organization_role"),
        )
        .outerjoin(
            organization_members,
            and_(
                organization_members.c.organization_id == people.c.organization_id,
                organization_members.c.user_id == people.c.user_id,
            ),
        )
        .where(and_(*person_conditions))
        .order_by(people.c.name, people.c.id)
    )
    guest_rows: list[object] = []
    if may_view_all:
        guest_rows = (
            await session.execute(
                select(people.c.id, people.c.name, people.c.role, people.c.email)
                .join(
                    organization_members,
                    and_(
                        organization_members.c.organization_id == actor.organization_id,
                        organization_members.c.user_id == people.c.user_id,
                    ),
                )
                .where(
                    and_(
                        people.c.organization_id == actor.organization_id,
                        people.c.is_active.is_(True),
                        organization_members.c.role == "client",
                    )
                )
                .order_by(people.c.name, people.c.id)
            )
        ).all()
    episode_conditions = [episodes.c.organization_id == actor.organization_id]
    if not may_view_all:
        if not actor.person_id:
            episode_conditions.append(episodes.c.id.is_(None))
        else:
            episode_conditions.append(
                episodes.c.id.in_(
                    select(episode_team_assignments.c.episode_id).where(
                        and_(
                            episode_team_assignments.c.organization_id == actor.organization_id,
                            episode_team_assignments.c.person_id == actor.person_id,
                        )
                    )
                )
            )
    episode_rows = await session.execute(
        select(episodes.c.id, episodes.c.number, episodes.c.title, shows.c.title.label("show_title"))
        .select_from(episodes)
        .join(seasons, and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id))
        .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
        .where(and_(*episode_conditions))
        .order_by(shows.c.title, episodes.c.number)
    )
    episode_rows = episode_rows.all()
    budget_items: list[object] = []
    if episode_rows:
        budget_items = (
            await session.execute(
                select(
                    budget_lines.c.id,
                    budget_lines.c.episode_id,
                    budget_lines.c.category,
                    budget_lines.c.description,
                    budget_lines.c.rate_snapshot,
                    budget_lines.c.planned_unit,
                )
                .where(
                    and_(
                        budget_lines.c.organization_id == actor.organization_id,
                        budget_lines.c.external_cost.is_(False),
                        budget_lines.c.episode_id.in_([row.id for row in episode_rows]),
                    )
                )
                .order_by(budget_lines.c.category, budget_lines.c.created_at, budget_lines.c.id)
            )
        ).all()
    return {
        "rooms": [{"id": str(row.id), "name": row.name, "type": row.type} for row in room_rows.all()],
        "people": [
            {
                "id": str(row.id),
                "name": row.name,
                "role": row.role,
                "email": row.email,
                "company": row.company,
                "availability": row.availability,
                "is_freelancer": row.is_freelancer,
                "hourly_rate": float(row.hourly_rate) if row.hourly_rate is not None else None,
                "organization_role": row.organization_role,
            }
            for row in person_rows.all()
        ],
        "guest_accounts": [
            {"id": str(row.id), "name": row.name, "role": row.role, "email": row.email} for row in guest_rows
        ],
        "episodes": [
            {"id": str(row.id), "label": f"{row.show_title} · E{row.number:02d} {row.title}"}
            for row in episode_rows
        ],
        "budget_items": [
            {
                "id": str(row.id),
                "episode_id": str(row.episode_id),
                "label": row.description or row.category,
                "has_rate_snapshot": row.rate_snapshot is not None and row.planned_unit is not None,
            }
            for row in budget_items
        ],
    }


async def _booking_or_404(session: DbSession, actor: CurrentActor, booking_id: str, *, lock: bool = False) -> object:
    statement = select(bookings).where(
        and_(bookings.c.id == booking_id, bookings.c.organization_id == actor.organization_id)
    )
    if lock:
        statement = statement.with_for_update()
    booking = (await session.execute(statement.limit(1))).first()
    if not booking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    return booking


async def _linked_work_orders(session: DbSession, actor: CurrentActor, booking_id: str, *, lock: bool) -> list[object]:
    statement = select(post_work_orders).where(
        and_(
            post_work_orders.c.organization_id == actor.organization_id,
            post_work_orders.c.booking_id == booking_id,
        )
    )
    if lock:
        statement = statement.with_for_update()
    return (await session.execute(statement)).all()


@router.get("/{booking_id}/time-submissions")
async def get_booking_time_submission(booking_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Let management review an actual while keeping other artists isolated."""
    booking = await _booking_or_404(session, actor, booking_id)
    may_review = await may_view_all_episodes(session, actor)
    is_assigned = bool(actor.person_id and str(booking.person_id or "") == actor.person_id)
    if actor.active_organization and actor.active_organization.role == "client":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Client accounts cannot review internal time."
        )
    if not may_review and not is_assigned:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    work_orders = await _linked_work_orders(session, actor, booking_id, lock=False)
    latest = (
        await session.execute(
            select(activity_log.c.metadata, activity_log.c.created_at)
            .where(
                and_(
                    activity_log.c.organization_id == actor.organization_id,
                    activity_log.c.entity_type == "booking",
                    activity_log.c.entity_id == booking_id,
                    activity_log.c.action.in_(("booking.time_confirmed", "booking.time_overrun_recorded")),
                )
            )
            .order_by(activity_log.c.created_at.desc())
            .limit(1)
        )
    ).first()
    work_order = work_orders[0] if len(work_orders) == 1 else None
    return {
        "booking_id": booking_id,
        "submitted": booking.actual_starts_at is not None and booking.actual_ends_at is not None,
        "actual_starts_at": booking.actual_starts_at,
        "actual_ends_at": booking.actual_ends_at,
        "overtime_minutes": booking.approved_overtime_minutes,
        "submitted_at": latest.created_at if latest else None,
        "cost": latest.metadata.get("actualCost") if latest else None,
        "budget_actual": latest.metadata.get("budgetActual") if latest else None,
        "work_order": {
            "id": str(work_order.id),
            "actual_amount": str(work_order.actual_amount) if work_order.actual_amount is not None else None,
            "currency": work_order.currency,
        }
        if work_order
        else None,
    }


@router.post("/{booking_id}/time-submissions", status_code=status.HTTP_201_CREATED)
async def submit_booking_actuals(
    booking_id: str, payload: BookingTimeSubmissionRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Confirm one artist's actual time and record its server-calculated cost."""
    await require_permission(session, actor, "update_assigned_work")
    if actor.active_organization and actor.active_organization.role == "client":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Client accounts cannot submit internal time."
        )
    if not actor.person_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="No active person record for time submission."
        )
    booking = await _booking_or_404(session, actor, booking_id, lock=True)
    if str(booking.person_id or "") != actor.person_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You can only confirm time for your own booking."
        )
    if booking.status != "confirmed" or booking.is_option:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a confirmed non-option booking can receive actual time.",
        )
    if booking.actual_starts_at is not None or booking.actual_ends_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Actual time is already confirmed for this booking."
        )

    work_orders = await _linked_work_orders(session, actor, booking_id, lock=True)
    if len(work_orders) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This booking is linked to more than one work order and cannot be costed safely.",
        )
    work_order = work_orders[0] if work_orders else None
    actual_cost = await _actual_cost(
        session,
        actor,
        booking=booking,
        actual_starts_at=payload.actual_starts_at,
        actual_ends_at=payload.actual_ends_at,
        overtime_minutes=payload.overtime_minutes,
    )
    budget_actual = await _booking_actual_allocation(
        session,
        actor,
        booking=booking,
        actual_hours=Decimal(str(actual_cost["actual_hours"])),
    )
    now = datetime.now(UTC)
    await session.execute(
        update(bookings)
        .where(and_(bookings.c.id == booking_id, bookings.c.organization_id == actor.organization_id))
        .values(
            actual_starts_at=payload.actual_starts_at,
            actual_ends_at=payload.actual_ends_at,
            approved_overtime_minutes=payload.overtime_minutes,
            updated_at=now,
        )
    )
    if budget_actual["status"] == "allocated":
        await record_budget_actual(
            session,
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            budget_line_id=str(budget_actual["budget_line_id"]),
            source_type="booking",
            booking_id=booking_id,
            amount=budget_actual["amount_decimal"],
            currency=str(budget_actual["currency"]),
            source_reference=f"booking-actual:{booking_id}",
        )
    if work_order and work_order.work_type == "internal":
        work_order_actual = (
            _decimal(budget_actual["amount"])
            if budget_actual["status"] == "allocated"
            else _decimal(actual_cost["total_internal_cost"])
        )
        await session.execute(
            update(post_work_orders)
            .where(
                and_(
                    post_work_orders.c.id == work_order.id,
                    post_work_orders.c.organization_id == actor.organization_id,
                )
            )
            .values(actual_amount=work_order_actual, updated_at=now)
        )

    planned_hours = confirmed_hours(booking.starts_at, booking.ends_at, 0)
    time_overrun = Decimal(str(actual_cost["actual_hours"])) > planned_hours
    metadata = {
        "episodeId": str(booking.episode_id) if booking.episode_id else None,
        "submittedByPersonId": actor.person_id,
        "actualStartsAt": payload.actual_starts_at.isoformat(),
        "actualEndsAt": payload.actual_ends_at.isoformat(),
        "overtimeMinutes": payload.overtime_minutes,
        "note": payload.note.strip() if payload.note else None,
        "actualCost": actual_cost,
        "budgetActual": {key: value for key, value in budget_actual.items() if key != "amount_decimal"},
        "workOrderId": str(work_order.id) if work_order else None,
    }
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="booking.time_overrun_recorded" if time_overrun else "booking.time_confirmed",
            entity_type="booking",
            entity_id=booking_id,
            metadata=metadata,
        )
    )
    if work_order:
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action="work_order.time_logged",
                entity_type="post_work_order",
                entity_id=str(work_order.id),
                metadata=metadata,
            )
        )
    await session.commit()
    return {
        "confirmed": True,
        "booking_id": booking_id,
        "time_overrun": time_overrun,
        "actual_internal_cost": actual_cost["total_internal_cost"],
        "currency": actual_cost["currency"],
        "cost": actual_cost,
        "work_order_id": str(work_order.id) if work_order else None,
    }


@router.post("/conflicts")
async def get_booking_conflicts(
    payload: BookingConflictRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_production")
    await _validate_references(session, actor, payload)
    if payload.exclude_booking_id and not await _tenant_reference_exists(
        session, bookings, actor.organization_id, payload.exclude_booking_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    if payload.status == "cancelled":
        return {"conflicts": [], "nearest_slot": None}
    return await _availability(session, actor, payload, exclude_booking_id=payload.exclude_booking_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_booking(payload: BookingCreateRequest, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_production")
    await _validate_references(session, actor, payload)
    values = payload.model_copy(deep=True)
    if values.is_option and values.status != "cancelled":
        values.status = "tentative"
    availability = await _availability(session, actor, values)
    if not values.is_option and availability["conflicts"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=jsonable_encoder(
                {"message": "This room or artist already has a conflicting booking.", **availability}
            ),
        )
    created = await session.execute(
        insert(bookings)
        .values(
            organization_id=actor.organization_id,
            title=values.title.strip(),
            room_id=values.room_id,
            episode_id=values.episode_id,
            budget_line_id=values.budget_line_id,
            person_id=values.person_id,
            guest_person_id=values.guest_person_id,
            starts_at=values.starts_at,
            ends_at=values.ends_at,
            setup_minutes=values.setup_minutes,
            handover_minutes=values.handover_minutes,
            is_option=values.is_option,
            option_rank=1 if is_active_option(_window(values)) else None,
            status=values.status,
            booking_type=values.booking_type,
            notes=values.notes.strip() if values.notes else None,
        )
        .returning(bookings)
    )
    row = created.one()
    await _resequence_active_options(session, actor, values)
    await _add_booking_client_to_episode_team(session, actor, values)
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="booking.created",
            entity_type="booking",
            entity_id=str(row.id),
            metadata={"episodeId": values.episode_id, "roomId": values.room_id, "personId": values.person_id},
        )
    )
    await session.commit()
    return _booking_values(row)


@router.patch("/{booking_id}")
async def update_booking(
    booking_id: str, payload: BookingCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_production")
    existing = (
        await session.execute(
            select(bookings).where(
                and_(bookings.c.id == booking_id, bookings.c.organization_id == actor.organization_id)
            )
        )
    ).first()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    previous = _payload_from_booking(existing)
    await _validate_references(session, actor, payload)
    if (
        (existing.actual_starts_at is not None or existing.actual_ends_at is not None)
        and str(existing.budget_line_id or "") != str(payload.budget_line_id or "")
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A booking's budget item cannot change after actual time has been confirmed.",
        )
    values = payload.model_copy(deep=True)
    if values.is_option and values.status != "cancelled":
        values.status = "tentative"
    availability = await _availability(session, actor, values, exclude_booking_id=booking_id)
    if not values.is_option and availability["conflicts"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=jsonable_encoder(
                {"message": "This room or artist already has a conflicting booking.", **availability}
            ),
        )
    changed = await session.execute(
        update(bookings)
        .where(and_(bookings.c.id == booking_id, bookings.c.organization_id == actor.organization_id))
        .values(
            title=values.title.strip(),
            room_id=values.room_id,
            episode_id=values.episode_id,
            budget_line_id=values.budget_line_id,
            person_id=values.person_id,
            guest_person_id=values.guest_person_id,
            starts_at=values.starts_at,
            ends_at=values.ends_at,
            setup_minutes=values.setup_minutes,
            handover_minutes=values.handover_minutes,
            is_option=values.is_option,
            option_rank=1 if is_active_option(_window(values)) else None,
            status=values.status,
            booking_type=values.booking_type,
            notes=values.notes.strip() if values.notes else None,
            updated_at=datetime.now(UTC),
        )
        .returning(bookings)
    )
    row = changed.one()
    # The old and the new resource windows may differ. Re-sequence both scopes
    # so withdrawing or moving a hold cannot leave a stale rank behind.
    if previous.is_option:
        await _resequence_active_options(session, actor, previous)
    if values.is_option:
        await _resequence_active_options(session, actor, values)
    await _add_booking_client_to_episode_team(session, actor, values)
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="booking.changed",
            entity_type="booking",
            entity_id=booking_id,
            metadata={
                "from": {"roomId": existing.room_id, "personId": existing.person_id},
                "episodeId": values.episode_id,
                "budgetLineId": values.budget_line_id,
            },
        )
    )
    await session.commit()
    return _booking_values(row)


@router.post("/guest-accounts", status_code=status.HTTP_201_CREATED)
async def create_booking_guest_account(
    payload: BookingGuestAccountRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Create a tenant-local client account and share only the selected episode."""
    await require_permission(session, actor, "manage_bookings")
    episode = (
        await session.execute(
            select(episodes.c.id)
            .where(and_(episodes.c.id == payload.episode_id, episodes.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    email = str(payload.email).lower().strip()
    user = (await session.execute(select(users.c.id).where(users.c.email == email).limit(1))).first()
    user_id = user.id if user else str(uuid4())
    member = (
        await session.execute(
            select(organization_members.c.user_id)
            .where(
                and_(
                    organization_members.c.organization_id == actor.organization_id,
                    organization_members.c.user_id == user_id,
                )
            )
            .limit(1)
        )
    ).first()
    if member:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This person already has access to this post house."
        )
    existing_person = (
        await session.execute(
            select(people.c.id, people.c.user_id)
            .where(and_(people.c.organization_id == actor.organization_id, people.c.email == email))
            .limit(1)
        )
    ).first()
    if existing_person and existing_person.user_id and existing_person.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This email is already linked to another tenant account."
        )
    if not user:
        from app.security import hash_node_scrypt_password

        await session.execute(
            insert(users).values(
                id=user_id, name=payload.name, email=email, password_hash=hash_node_scrypt_password(payload.password)
            )
        )
    await session.execute(
        insert(organization_members).values(organization_id=actor.organization_id, user_id=user_id, role="client")
    )
    if existing_person:
        person_id = existing_person.id
        await session.execute(
            update(people)
            .where(and_(people.c.id == person_id, people.c.organization_id == actor.organization_id))
            .values(user_id=user_id, name=payload.name, role="client", is_active=True, updated_at=datetime.now(UTC))
        )
    else:
        person_id = (
            await session.execute(
                insert(people)
                .values(
                    organization_id=actor.organization_id,
                    user_id=user_id,
                    name=payload.name,
                    email=email,
                    role="client",
                )
                .returning(people.c.id)
            )
        ).scalar_one()
    await session.execute(
        pg_insert(episode_team_assignments)
        .values(
            organization_id=actor.organization_id, episode_id=payload.episode_id, person_id=person_id, is_lead=False
        )
        .on_conflict_do_nothing(index_elements=["episode_id", "person_id"])
    )
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="booking.guest_account_created",
            entity_type="person",
            entity_id=str(person_id),
            metadata={"episodeId": payload.episode_id, "email": email, "role": "client"},
        )
    )
    await session.commit()
    return {"id": str(person_id), "name": payload.name, "role": "client", "email": email}


@router.post("/copy-episode", status_code=status.HTTP_201_CREATED)
async def copy_episode_bookings(
    payload: CopyEpisodeBookingsRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_bookings")
    episode_rows = (
        await session.execute(
            select(episodes.c.id, episodes.c.production_code).where(
                and_(
                    episodes.c.organization_id == actor.organization_id,
                    episodes.c.id.in_([payload.source_episode_id, payload.target_episode_id]),
                )
            )
        )
    ).all()
    source = next((item for item in episode_rows if str(item.id) == payload.source_episode_id), None)
    target = next((item for item in episode_rows if str(item.id) == payload.target_episode_id), None)
    if not source or not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source or target episode was not found.")
    source_bookings = (
        await session.execute(
            select(bookings)
            .where(
                and_(
                    bookings.c.organization_id == actor.organization_id,
                    bookings.c.episode_id == source.id,
                    bookings.c.status != "cancelled",
                )
            )
            .order_by(bookings.c.starts_at)
        )
    ).all()
    if not source_bookings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The source episode has no bookings to copy."
        )
    source_day = source_bookings[0].starts_at.replace(hour=0, minute=0, second=0, microsecond=0)
    target_day = payload.starts_on.replace(hour=0, minute=0, second=0, microsecond=0)
    copies: list[BookingCreateRequest] = []
    for booking in source_bookings:
        starts_at = target_day + (booking.starts_at - source_day)
        ends_at = starts_at + (booking.ends_at - booking.starts_at)
        candidate = BookingCreateRequest(
            title=(
                booking.title.replace(source.production_code, target.production_code)
                if source.production_code and target.production_code
                else booking.title
            ),
            room_id=str(booking.room_id) if booking.room_id else None,
            person_id=str(booking.person_id) if booking.person_id else None,
            episode_id=str(target.id),
            budget_line_id=None,
            starts_at=starts_at,
            ends_at=ends_at,
            setup_minutes=booking.setup_minutes,
            handover_minutes=booking.handover_minutes,
            status="tentative",
            booking_type=booking.booking_type,
            notes=booking.notes,
        )
        availability = await _availability(session, actor, candidate)
        if availability["conflicts"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "The copied sequence conflicts with existing room or personnel bookings.",
                    **availability,
                },
            )
        copies.append(candidate)
    await session.execute(
        insert(bookings),
        [
            {
                "organization_id": actor.organization_id,
                "title": item.title,
                "room_id": item.room_id,
                "person_id": item.person_id,
                "episode_id": item.episode_id,
                "starts_at": item.starts_at,
                "ends_at": item.ends_at,
                "setup_minutes": item.setup_minutes,
                "handover_minutes": item.handover_minutes,
                "status": "tentative",
                "booking_type": item.booking_type,
                "is_option": False,
                "notes": item.notes,
            }
            for item in copies
        ],
    )
    await session.commit()
    return {"created": len(copies)}


@router.post("/{booking_id}/flag-conflict")
async def flag_booking_conflict(
    booking_id: str, payload: BookingConflictFlagRequest, actor: CurrentActor, session: DbSession
) -> dict[str, bool]:
    await require_permission(session, actor, "update_assigned_work")
    if not actor.person_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No active person record.")
    booking = await _booking_or_404(session, actor, booking_id)
    if str(booking.person_id or "") != actor.person_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="booking.conflict_flagged",
            entity_type="booking",
            entity_id=booking_id,
            metadata={
                "episodeId": str(booking.episode_id) if booking.episode_id else None,
                "reason": payload.reason,
                "recipientPersonIds": [actor.person_id],
                "notificationTitle": "Booking conflict flagged",
                "notificationBody": f"{booking.title}: {payload.reason}",
            },
        )
    )
    await session.commit()
    return {"flagged": True}
