# ruff: noqa: E501
"""Tenant-safe catering and runner-desk operations.

The API deliberately stores only operational requests and receipt totals.  It
does not store payment details, dietary profiles, or media data.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, insert, or_, select, update

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import CateringRequestCreateRequest, CateringRequestUpdateRequest
from app.auth import require_permission
from app.db.tables import (
    activity_log,
    billables,
    bookings,
    budget_lines,
    catering_requests,
    catering_settings,
    episodes,
    people,
    post_work_orders,
    rooms,
    seasons,
    shows,
)

router = APIRouter(tags=["catering"])


def _money(value: object | None) -> float | None:
    return float(value) if value is not None else None


def _request_response(row: object) -> dict[str, object]:
    return {
        "id": str(row.id),
        "request_type": row.request_type,
        "item": row.item,
        "quantity": row.quantity,
        "notes": row.notes,
        "requested_for": row.requested_for,
        "status": row.status,
        "fulfilled_at": row.fulfilled_at,
        "actual_cost": _money(row.actual_cost),
        "billed_amount": _money(row.billed_amount),
        "markup_percent": _money(row.markup_percent),
        "currency": row.currency,
        "receipt_reference": row.receipt_reference,
        "created_at": row.created_at,
        "requested_by_person_id": str(row.requested_by_person_id) if row.requested_by_person_id else None,
        "room_id": str(row.room_id) if row.room_id else None,
        "room_name": row.room_name,
        "booking_id": str(row.booking_id) if row.booking_id else None,
        "work_order_id": str(row.work_order_id) if row.work_order_id else None,
        "requester_name": row.requester_name,
    }


async def _current_person(session: DbSession, actor: CurrentActor) -> object | None:
    return (
        await session.execute(
            select(people.c.id, people.c.name, people.c.role)
            .where(and_(people.c.organization_id == actor.organization_id, people.c.user_id == actor.user_id))
            .limit(1)
        )
    ).first()


@router.get("/catering-requests")
async def list_catering_requests(actor: CurrentActor, session: DbSession) -> list[dict[str, object]]:
    await require_permission(session, actor, "request_catering")
    may_manage = "manage_catering" in actor.permissions
    person = await _current_person(session, actor)
    requester = people.alias("catering_requester")
    statement = (
        select(
            catering_requests,
            rooms.c.name.label("room_name"),
            requester.c.name.label("requester_name"),
        )
        .select_from(catering_requests)
        .outerjoin(
            rooms, and_(rooms.c.id == catering_requests.c.room_id, rooms.c.organization_id == actor.organization_id)
        )
        .outerjoin(
            requester,
            and_(
                requester.c.id == catering_requests.c.requested_by_person_id,
                requester.c.organization_id == actor.organization_id,
            ),
        )
        .where(catering_requests.c.organization_id == actor.organization_id)
        .order_by(catering_requests.c.status, catering_requests.c.requested_for, catering_requests.c.created_at)
    )
    if not may_manage:
        if not person:
            return []
        statement = statement.where(catering_requests.c.requested_by_person_id == person.id)
    rows = (await session.execute(statement)).all()
    return [_request_response(row) for row in rows]


@router.get("/catering/resources")
async def catering_resources(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "request_catering")
    now = datetime.now(UTC)
    person = await _current_person(session, actor)
    room_rows = await session.execute(
        select(rooms.c.id, rooms.c.name, rooms.c.type)
        .where(rooms.c.organization_id == actor.organization_id)
        .order_by(rooms.c.name)
    )
    active_booking = None
    active_work_order = None
    if person:
        active_booking = (
            await session.execute(
                select(bookings.c.id, bookings.c.room_id, rooms.c.name.label("room_name"))
                .select_from(bookings)
                .join(rooms, and_(rooms.c.id == bookings.c.room_id, rooms.c.organization_id == actor.organization_id))
                .where(
                    and_(
                        bookings.c.organization_id == actor.organization_id,
                        bookings.c.episode_id.is_not(None),
                        bookings.c.starts_at <= now,
                        bookings.c.ends_at >= now,
                        or_(bookings.c.person_id == person.id, bookings.c.guest_person_id == person.id),
                    )
                )
                .order_by(bookings.c.starts_at.desc())
                .limit(1)
            )
        ).first()
        active_work_order = (
            await session.execute(
                select(post_work_orders.c.id, post_work_orders.c.episode_id, post_work_orders.c.title)
                .where(
                    and_(
                        post_work_orders.c.organization_id == actor.organization_id,
                        post_work_orders.c.work_type == "internal",
                        post_work_orders.c.status == "in_progress",
                        or_(
                            post_work_orders.c.assignee_person_id == person.id,
                            post_work_orders.c.assignee_role == person.role,
                        ),
                    )
                )
                .order_by(post_work_orders.c.updated_at.desc().nulls_last(), post_work_orders.c.created_at.desc())
                .limit(1)
            )
        ).first()
    return {
        "rooms": [{"id": str(row.id), "name": row.name, "type": row.type} for row in room_rows.all()],
        "active_booking": (
            {"id": str(active_booking.id), "room_id": str(active_booking.room_id), "room_name": active_booking.room_name}
            if active_booking
            else None
        ),
        "active_work_order": (
            {
                "id": str(active_work_order.id),
                "episode_id": str(active_work_order.episode_id),
                "title": active_work_order.title,
            }
            if active_work_order
            else None
        ),
    }


@router.post("/catering-requests", status_code=status.HTTP_201_CREATED)
async def create_catering_request(
    payload: CateringRequestCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "request_catering")
    person = await _current_person(session, actor)
    if bool(payload.booking_id) == bool(payload.work_order_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Catering requires one active booking or assigned work order.",
        )
    booking = None
    work_order = None
    if payload.booking_id:
        booking_conditions = [
            bookings.c.id == payload.booking_id,
            bookings.c.organization_id == actor.organization_id,
        ]
        if actor.active_organization and actor.active_organization.role == "client":
            if not person:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client account is not linked to a person.")
            booking_conditions.extend(
                [
                    bookings.c.starts_at <= datetime.now(UTC),
                    bookings.c.ends_at >= datetime.now(UTC),
                    bookings.c.episode_id.is_not(None),
                    or_(bookings.c.person_id == person.id, bookings.c.guest_person_id == person.id),
                ]
            )
        booking = (
            await session.execute(
                select(bookings.c.id, bookings.c.room_id)
                .where(and_(*booking_conditions))
                .limit(1)
            )
        ).first()
        if not booking:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    if payload.work_order_id:
        if not person or (actor.active_organization and actor.active_organization.role == "client"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only assigned internal workers can charge catering to a work order.")
        work_order = (
            await session.execute(
                select(post_work_orders.c.id, post_work_orders.c.episode_id)
                .where(
                    and_(
                        post_work_orders.c.id == payload.work_order_id,
                        post_work_orders.c.organization_id == actor.organization_id,
                        post_work_orders.c.work_type == "internal",
                        post_work_orders.c.status == "in_progress",
                        or_(
                            post_work_orders.c.assignee_person_id == person.id,
                            post_work_orders.c.assignee_role == person.role,
                        ),
                    )
                )
                .limit(1)
            )
        ).first()
        if not work_order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active assigned work order not found.")
    if payload.room_id:
        room = (
            await session.execute(
                select(rooms.c.id)
                .where(and_(rooms.c.id == payload.room_id, rooms.c.organization_id == actor.organization_id))
                .limit(1)
            )
        ).first()
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    row = (
        await session.execute(
            insert(catering_requests)
            .values(
                organization_id=actor.organization_id,
                booking_id=payload.booking_id,
                work_order_id=payload.work_order_id,
                # The booking keeps the episode billing connection. The room
                # is a practical delivery location and may change at short
                # notice without changing the client's booked episode.
                room_id=payload.room_id or (booking.room_id if booking else None),
                requested_by_person_id=person.id if person else None,
                request_type=payload.request_type,
                item=payload.item,
                quantity=payload.quantity,
                requested_for=payload.requested_for,
                notes=payload.notes,
                status="requested",
                currency=actor.active_organization.currency,
            )
            .returning(catering_requests.c.id)
        )
    ).first()
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="catering.requested",
            entity_type="catering_request",
            entity_id=str(row.id),
            metadata={"type": payload.request_type, "item": payload.item},
        )
    )
    await session.commit()
    return {"id": str(row.id)}


@router.patch("/catering-requests/{request_id}")
async def update_catering_request(
    request_id: str, payload: CateringRequestUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_catering")
    request_row = (
        await session.execute(
            select(
                catering_requests,
                bookings.c.episode_id.label("booking_episode_id"),
                post_work_orders.c.episode_id.label("work_order_episode_id"),
            )
            .select_from(catering_requests)
            .outerjoin(
                bookings,
                and_(
                    bookings.c.id == catering_requests.c.booking_id,
                    bookings.c.organization_id == actor.organization_id,
                ),
            )
            .outerjoin(post_work_orders, and_(post_work_orders.c.id == catering_requests.c.work_order_id, post_work_orders.c.organization_id == actor.organization_id))
            .where(
                and_(catering_requests.c.id == request_id, catering_requests.c.organization_id == actor.organization_id)
            )
            .limit(1)
        )
    ).first()
    if not request_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catering request not found.")
    runner = await _current_person(session, actor)
    markup = (
        await session.execute(
            select(catering_settings.c.markup_percent)
            .where(catering_settings.c.organization_id == actor.organization_id)
            .limit(1)
        )
    ).first()
    markup_percent = float(markup.markup_percent) if markup else 0.0
    values: dict[str, object] = {
        "status": payload.status,
        "fulfilled_by_person_id": runner.id if runner else None,
        "fulfilled_at": datetime.now(UTC) if payload.status == "delivered" else None,
        "updated_at": datetime.now(UTC),
    }
    billable_id = request_row.billable_id
    budget_line_id = request_row.budget_line_id
    if payload.actual_cost is not None:
        episode_id = request_row.booking_episode_id or request_row.work_order_episode_id
        if not episode_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This catering request is not linked to an episode, so it cannot be billed.",
            )
        episode_scope = (
            await session.execute(
                select(episodes.c.id, episodes.c.season_id, seasons.c.show_id)
                .select_from(episodes)
                .join(seasons, and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id))
                .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
                .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
                .limit(1)
            )
        ).first()
        if not episode_scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
        billed_amount = round(payload.actual_cost * (1 + markup_percent / 100), 2)
        # Catering stays operational until the runner records the receipt.
        # At that point it creates/updates one live client billable and one
        # actual episode budget line, exactly like the historical Node route.
        if billable_id:
            await session.execute(
                update(billables)
                .where(and_(billables.c.id == billable_id, billables.c.organization_id == actor.organization_id))
                .values(
                    amount=billed_amount,
                    currency=actor.active_organization.currency,
                    description=f"Catering — {request_id}",
                    reference=payload.receipt_reference,
                    updated_at=datetime.now(UTC),
                )
            )
        else:
            billable_id = (
                await session.execute(
                    insert(billables)
                    .values(
                        organization_id=actor.organization_id,
                        show_id=episode_scope.show_id,
                        episode_id=episode_scope.id,
                        vendor="Catering",
                        reference=payload.receipt_reference,
                        description=f"Catering — {request_id}",
                        amount=billed_amount,
                        currency=actor.active_organization.currency,
                        status="draft",
                    )
                    .returning(billables.c.id)
                )
            ).scalar_one()
        if budget_line_id:
            await session.execute(
                update(budget_lines)
                .where(
                    and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == actor.organization_id)
                )
                .values(
                    actual_amount=payload.actual_cost,
                    currency=actor.active_organization.currency,
                    updated_at=datetime.now(UTC),
                )
            )
        else:
            budget_line_id = (
                await session.execute(
                    insert(budget_lines)
                    .values(
                        organization_id=actor.organization_id,
                        show_id=episode_scope.show_id,
                        season_id=episode_scope.season_id,
                        episode_id=episode_scope.id,
                        work_order_id=request_row.work_order_id,
                        code=f"CATERING-{request_id[:8]}",
                        category="Catering",
                        description="Runner fulfilled catering request",
                        budgeted_amount=0,
                        actual_amount=payload.actual_cost,
                        currency=actor.active_organization.currency,
                        cost_type="billable",
                        external_cost=False,
                    )
                    .returning(budget_lines.c.id)
                )
            ).scalar_one()
        values.update(
            actual_cost=payload.actual_cost,
            billed_amount=billed_amount,
            markup_percent=markup_percent,
            currency=actor.active_organization.currency,
            billable_id=billable_id,
            budget_line_id=budget_line_id,
        )
    if "receipt_reference" in payload.model_fields_set:
        values["receipt_reference"] = payload.receipt_reference
    await session.execute(
        update(catering_requests)
        .where(and_(catering_requests.c.id == request_id, catering_requests.c.organization_id == actor.organization_id))
        .values(**values)
    )
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="catering.cost_recorded" if payload.actual_cost is not None else f"catering.{payload.status}",
            entity_type="catering_request",
            entity_id=request_id,
            metadata={
                "actual_cost": payload.actual_cost,
                "billable_id": str(billable_id) if billable_id else None,
                "budget_line_id": str(budget_line_id) if budget_line_id else None,
            }
            if payload.actual_cost is not None
            else {},
        )
    )
    await session.commit()
    return {"ok": True, "status": payload.status}
