"""Tenant-scoped operational work orders and supplier-PO commitments."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, delete, func, insert, or_, select, update

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import may_view_all_episodes
from app.api.schemas import WorkOrderBookingRequest, WorkOrderCreateRequest, WorkOrderUpdateRequest
from app.auth import has_permission, require_permission
from app.booking_logic import booking_conflicts
from app.budget_logic import decimal_amount, json_safe
from app.db.tables import (
    activity_log,
    bookings,
    budget_lines,
    client_purchase_order_allocations,
    client_purchase_orders,
    crm_companies,
    episodes,
    people,
    post_work_order_items,
    post_work_orders,
    purchase_order_allocations,
    purchase_orders,
    rooms,
    seasons,
    shows,
    vendor_invoices,
    workflow_stages,
)
from app.vendor_spend import external_budget_line_for_episode

router = APIRouter(prefix="/work-orders", tags=["work-orders"])


def _decimal(value: object | None) -> Decimal:
    return decimal_amount(value)


def _work_order_value(row: object, items: list[object] | None = None) -> dict[str, object]:
    value = {
        "id": str(row.id),
        "episode_id": str(row.episode_id),
        "workflow_stage_id": str(row.workflow_stage_id) if row.workflow_stage_id else None,
        "booking_id": str(row.booking_id) if row.booking_id else None,
        "work_type": row.work_type,
        "vendor_company_id": str(row.vendor_company_id) if row.vendor_company_id else None,
        "purchase_order_id": str(row.purchase_order_id) if row.purchase_order_id else None,
        "budget_line_id": str(row.budget_line_id) if row.budget_line_id else None,
        "client_purchase_order_id": str(row.client_purchase_order_id) if row.client_purchase_order_id else None,
        "kind": row.kind,
        "title": row.title,
        "description": row.description,
        "department": row.department,
        "assignee_person_id": str(row.assignee_person_id) if row.assignee_person_id else None,
        "assignee_role": row.assignee_role,
        "priority": row.priority,
        "is_blocking": row.is_blocking,
        "status": row.status,
        "billing_scope": row.billing_scope,
        "billing_status": row.billing_status,
        "estimated_amount": str(row.estimated_amount) if row.estimated_amount is not None else None,
        "client_quote_amount": str(row.client_quote_amount) if row.client_quote_amount is not None else None,
        "currency": row.currency,
        "billing_notes": row.billing_notes,
        "external_url": row.external_url,
        "due_at": row.due_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    if items is not None:
        value["items"] = [
            {
                "id": str(item.id),
                "type": item.type,
                "description": item.description,
                "quantity": str(item.quantity),
                "unit": item.unit,
                "unit_rate": str(item.unit_rate),
                "discount_percent": str(item.discount_percent),
                "notes": item.notes,
                "position": item.position,
            }
            for item in items
        ]
    return value


async def _audit(
    session: DbSession,
    actor: CurrentActor,
    *,
    action: str,
    work_order_id: str,
    episode_id: str,
    metadata: dict[str, object] | None = None,
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type="post_work_order",
            entity_id=work_order_id,
            metadata=json_safe({"episodeId": episode_id, **(metadata or {})}),
        )
    )


async def _tenant_record(
    session: DbSession, table, actor: CurrentActor, record_id: str | None, label: str
) -> object | None:
    if not record_id:
        return None
    record = (
        await session.execute(
            select(table)
            .where(and_(table.c.id == record_id, table.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found.")
    return record


async def _episode_scope(session: DbSession, actor: CurrentActor, episode_id: str) -> object:
    episode = (
        await session.execute(
            select(
                episodes.c.id,
                episodes.c.workflow_stage_id,
                seasons.c.show_id,
                shows.c.client_company_id,
            )
            .join(
                seasons, and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id)
            )
            .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    return episode


async def _validate_create_references(
    session: DbSession, actor: CurrentActor, payload: WorkOrderCreateRequest
) -> object:
    episode = await _episode_scope(session, actor, payload.episode_id)
    stage = await _tenant_record(session, workflow_stages, actor, payload.workflow_stage_id, "Workflow stage")
    booking = await _tenant_record(session, bookings, actor, payload.booking_id, "Booking")
    await _tenant_record(session, people, actor, payload.assignee_person_id, "Assigned person")

    if booking and booking.episode_id != episode.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Booking must belong to this episode.")
    if stage and episode.workflow_stage_id:
        current_stage = await _tenant_record(
            session, workflow_stages, actor, str(episode.workflow_stage_id), "Episode workflow stage"
        )
        if current_stage and stage.workflow_id != current_stage.workflow_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Workflow stage does not belong to this episode's workflow.",
            )
    if payload.work_type == "external_vendor":
        vendor = await _tenant_record(session, crm_companies, actor, payload.vendor_company_id, "Vendor")
        if vendor.type != "vendor":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Select a vendor account for external work."
            )
        po = await _tenant_record(session, purchase_orders, actor, payload.purchase_order_id, "Purchase order")
        if po and (
            po.status != "approved"
            or po.vendor_company_id != payload.vendor_company_id
            or (po.show_id and po.show_id != episode.show_id)
            or (po.episode_id and po.episode_id != episode.id)
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Select an approved PO for this vendor and episode."
            )
        if payload.budget_line_id:
            await external_budget_line_for_episode(
                session,
                organization_id=actor.organization_id,
                episode_id=str(episode.id),
                budget_line_id=payload.budget_line_id,
                purchase_order_id=payload.purchase_order_id,
            )
    elif payload.purchase_order_id or payload.budget_line_id:
        # Pydantic catches normal internal work; this protects a deliberately
        # malformed request as well.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Internal work cannot use a vendor PO or external budget item.",
        )

    await _validate_client_purchase_order_scope(
        session,
        actor,
        episode=episode,
        client_purchase_order_id=payload.client_purchase_order_id,
    )
    return episode


async def _validate_external_vendor_scope(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode: object,
    vendor_company_id: str | None,
    purchase_order_id: str | None,
    require_approved_po: bool = True,
) -> object | None:
    """Resolve a vendor PO only inside the active tenant and episode scope."""
    vendor = await _tenant_record(session, crm_companies, actor, vendor_company_id, "Vendor")
    if not vendor or vendor.type != "vendor":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select a vendor account for external work.",
        )
    order = await _tenant_record(session, purchase_orders, actor, purchase_order_id, "Purchase order")
    if order and (
        (require_approved_po and order.status != "approved")
        or str(order.vendor_company_id) != vendor_company_id
        or (order.show_id and str(order.show_id) != str(episode.show_id))
        or (order.episode_id and str(order.episode_id) != str(episode.id))
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Select an approved PO for this vendor and episode.",
        )
    return order


async def _validate_client_purchase_order_scope(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode: object,
    client_purchase_order_id: str | None,
) -> object | None:
    """Resolve a client billing authority only inside its client/show/episode scope."""
    order = await _tenant_record(
        session, client_purchase_orders, actor, client_purchase_order_id, "Client purchase order"
    )
    if order and (
        order.status != "active"
        or str(order.client_company_id) != str(episode.client_company_id)
        or (order.show_id and str(order.show_id) != str(episode.show_id))
        or (order.episode_id and str(order.episode_id) != str(episode.id))
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Select an active client PO for this client and episode.",
        )
    return order


async def _work_order_or_404(
    session: DbSession, actor: CurrentActor, work_order_id: str, *, lock: bool = False
) -> object:
    statement = select(post_work_orders).where(
        and_(
            post_work_orders.c.id == work_order_id,
            post_work_orders.c.organization_id == actor.organization_id,
        )
    )
    if lock:
        # All update paths use this lock so a concurrent approval/edit cannot
        # create two commitment rows for the same work order.
        statement = statement.with_for_update()
    record = (await session.execute(statement.limit(1))).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found.")
    return record


async def _existing_po_commitments(session: DbSession, actor: CurrentActor, work_order_id: str) -> list[object]:
    """Return every historical duplicate too, so an edit repairs legacy data."""
    return (
        await session.execute(
            select(purchase_order_allocations)
            .where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.work_order_id == work_order_id,
                    purchase_order_allocations.c.allocation_type == "work_order",
                )
            )
            .order_by(purchase_order_allocations.c.created_at, purchase_order_allocations.c.id)
        )
    ).all()


async def _po_committed_total(session: DbSession, actor: CurrentActor, purchase_order_id: str) -> Decimal:
    total = await session.scalar(
        select(func.coalesce(func.sum(purchase_order_allocations.c.amount), 0)).where(
            and_(
                purchase_order_allocations.c.organization_id == actor.organization_id,
                purchase_order_allocations.c.purchase_order_id == purchase_order_id,
                purchase_order_allocations.c.allocation_type.in_(("work_order", "budget_line")),
            )
        )
    )
    return _decimal(total)


async def _plan_po_commitment(
    session: DbSession,
    actor: CurrentActor,
    *,
    work_order: object,
    order: object,
    estimated_amount: Decimal | None,
    existing: list[object],
    overrun_reason: str | None,
) -> dict[str, object]:
    """Validate the new live total before the transaction mutates the ledger."""
    amount = _decimal(estimated_amount)
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Add an estimated vendor cost before approving work linked to a PO.",
        )
    committed = await _po_committed_total(session, actor, str(order.id))
    prior_on_target = sum(
        (_decimal(item.amount) for item in existing if str(item.purchase_order_id) == str(order.id)), Decimal(0)
    )
    proposed = committed - prior_on_target + amount
    overrun = max(Decimal(0), proposed - _decimal(order.approved_amount))
    reason = overrun_reason.strip() if overrun_reason else None
    if overrun > 0 and not reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explain the PO overrun before authorising it.",
        )
    return {
        "purchase_order_id": str(order.id),
        "amount": amount,
        "allocation_date": datetime.now(UTC).date(),
        "reference": f"WO-{str(work_order.id)[:8].upper()}",
        "description": "Approved external vendor work-order commitment.",
        "overrun": overrun,
        "overrun_reason": reason,
    }


async def _apply_po_commitment(
    session: DbSession,
    actor: CurrentActor,
    *,
    work_order_id: str,
    existing: list[object],
    plan: dict[str, object] | None,
    now: datetime,
) -> tuple[str | None, list[object]]:
    """Upsert one commitment or remove all of them when commercial scope ends."""
    primary = existing[0] if existing else None
    stale = existing[1:]
    if plan is None:
        if existing:
            await session.execute(
                delete(purchase_order_allocations).where(
                    and_(
                        purchase_order_allocations.c.organization_id == actor.organization_id,
                        purchase_order_allocations.c.id.in_([item.id for item in existing]),
                    )
                )
            )
        return None, existing

    if stale:
        await session.execute(
            delete(purchase_order_allocations).where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.id.in_([item.id for item in stale]),
                )
            )
        )
    if primary:
        await session.execute(
            update(purchase_order_allocations)
            .where(
                and_(
                    purchase_order_allocations.c.id == primary.id,
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                )
            )
            .values(
                purchase_order_id=plan["purchase_order_id"],
                amount=plan["amount"],
                allocation_date=plan["allocation_date"],
                reference=plan["reference"],
                description=plan["description"],
                updated_at=now,
            )
        )
        return str(primary.id), existing
    created = await session.execute(
        insert(purchase_order_allocations)
        .values(
            organization_id=actor.organization_id,
            purchase_order_id=plan["purchase_order_id"],
            allocation_type="work_order",
            work_order_id=work_order_id,
            amount=plan["amount"],
            allocation_date=plan["allocation_date"],
            reference=plan["reference"],
            description=plan["description"],
            created_by_user_id=actor.user_id,
            created_at=now,
            updated_at=now,
        )
        .returning(purchase_order_allocations.c.id)
    )
    return str(created.scalar_one()), existing


async def _existing_client_po_commitments(session: DbSession, actor: CurrentActor, work_order_id: str) -> list[object]:
    """Return all rows so a retry also repairs legacy duplicate commitments."""
    return (
        await session.execute(
            select(client_purchase_order_allocations)
            .where(
                and_(
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                    client_purchase_order_allocations.c.work_order_id == work_order_id,
                    client_purchase_order_allocations.c.allocation_type == "work_order",
                )
            )
            .order_by(client_purchase_order_allocations.c.created_at, client_purchase_order_allocations.c.id)
        )
    ).all()


async def _client_po_committed_total(session: DbSession, actor: CurrentActor, client_purchase_order_id: str) -> Decimal:
    total = await session.scalar(
        select(func.coalesce(func.sum(client_purchase_order_allocations.c.amount), 0)).where(
            and_(
                client_purchase_order_allocations.c.organization_id == actor.organization_id,
                client_purchase_order_allocations.c.client_purchase_order_id == client_purchase_order_id,
                client_purchase_order_allocations.c.allocation_type.in_(("billable", "change_order", "work_order")),
            )
        )
    )
    return _decimal(total)


async def _plan_client_po_commitment(
    session: DbSession,
    actor: CurrentActor,
    *,
    work_order: object,
    order: object,
    client_quote_amount: Decimal | None,
    existing: list[object],
    overrun_reason: str | None,
) -> dict[str, object]:
    """Validate the live client-authorisation balance before reserving it."""
    amount = _decimal(client_quote_amount)
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Add a quoted client amount before approving work linked to a client PO.",
        )
    # Serialise commitments to this client authorisation. A row lock on the
    # work order prevents duplicate rows for one work order; this lock also
    # prevents separate work orders from racing the PO remaining balance.
    await session.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"postpilot-client-po:{order.id}"))))
    committed = await _client_po_committed_total(session, actor, str(order.id))
    prior_on_target = sum(
        (_decimal(item.amount) for item in existing if str(item.client_purchase_order_id) == str(order.id)),
        Decimal(0),
    )
    proposed = committed - prior_on_target + amount
    overrun = max(Decimal(0), proposed - _decimal(order.approved_amount))
    reason = overrun_reason.strip() if overrun_reason else None
    if overrun > 0 and not reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explain the client PO overrun before approving this billable work.",
        )
    return {
        "client_purchase_order_id": str(order.id),
        "amount": amount,
        "allocation_date": datetime.now(UTC).date(),
        "reference": f"WO-{str(work_order.id)[:8].upper()}",
        "description": "Approved client-billable work-order commitment.",
        "overrun": overrun,
        "overrun_reason": reason,
    }


async def _apply_client_po_commitment(
    session: DbSession,
    actor: CurrentActor,
    *,
    work_order_id: str,
    existing: list[object],
    plan: dict[str, object] | None,
    now: datetime,
) -> tuple[str | None, list[object]]:
    """Maintain exactly one client-PO commitment for an approved work order."""
    primary = existing[0] if existing else None
    stale = existing[1:]
    if plan is None:
        if existing:
            await session.execute(
                delete(client_purchase_order_allocations).where(
                    and_(
                        client_purchase_order_allocations.c.organization_id == actor.organization_id,
                        client_purchase_order_allocations.c.id.in_([item.id for item in existing]),
                    )
                )
            )
        return None, existing

    if stale:
        await session.execute(
            delete(client_purchase_order_allocations).where(
                and_(
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                    client_purchase_order_allocations.c.id.in_([item.id for item in stale]),
                )
            )
        )
    if primary:
        await session.execute(
            update(client_purchase_order_allocations)
            .where(
                and_(
                    client_purchase_order_allocations.c.id == primary.id,
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                )
            )
            .values(
                client_purchase_order_id=plan["client_purchase_order_id"],
                amount=plan["amount"],
                allocation_date=plan["allocation_date"],
                reference=plan["reference"],
                description=plan["description"],
                overrun_authorised=bool(plan["overrun"]),
                updated_at=now,
            )
        )
        return str(primary.id), existing
    created = await session.execute(
        insert(client_purchase_order_allocations)
        .values(
            organization_id=actor.organization_id,
            client_purchase_order_id=plan["client_purchase_order_id"],
            allocation_type="work_order",
            work_order_id=work_order_id,
            amount=plan["amount"],
            overrun_authorised=bool(plan["overrun"]),
            allocation_date=plan["allocation_date"],
            reference=plan["reference"],
            description=plan["description"],
            created_by_user_id=actor.user_id,
            created_at=now,
            updated_at=now,
        )
        .returning(client_purchase_order_allocations.c.id)
    )
    return str(created.scalar_one()), existing


async def _can_access_work_order(session: DbSession, actor: CurrentActor, work_order: object) -> bool:
    if await may_view_all_episodes(session, actor):
        return True
    if not actor.person_id or actor.active_organization and actor.active_organization.role == "client":
        return False
    return work_order.assignee_person_id == actor.person_id or work_order.assignee_role == actor.person_role


@router.get("")
async def list_work_orders(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    conditions = [post_work_orders.c.organization_id == actor.organization_id]
    if not await may_view_all_episodes(session, actor):
        if not actor.person_id or actor.active_organization and actor.active_organization.role == "client":
            conditions.append(post_work_orders.c.id.is_(None))
        else:
            conditions.append(
                or_(
                    post_work_orders.c.assignee_person_id == actor.person_id,
                    post_work_orders.c.assignee_role == actor.person_role,
                )
            )
    rows = (
        await session.execute(
            select(post_work_orders)
            .where(and_(*conditions))
            .order_by(post_work_orders.c.due_at.asc().nulls_last(), post_work_orders.c.created_at.desc())
        )
    ).all()
    return {"work_orders": [_work_order_value(row) for row in rows]}


@router.get("/inbox")
async def work_order_inbox(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """The assigned-work read model shared by Approvals and Bookings."""
    if not actor.person_id or (actor.active_organization and actor.active_organization.role == "client"):
        return {"work_orders": []}
    rows = (
        await session.execute(
            select(
                post_work_orders,
                episodes.c.id.label("scoped_episode_id"),
                episodes.c.title.label("episode_title"),
                episodes.c.number.label("episode_number"),
                shows.c.id.label("show_id"),
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
            .where(
                and_(
                    post_work_orders.c.organization_id == actor.organization_id,
                    post_work_orders.c.status.not_in(("complete", "cancelled")),
                    or_(
                        post_work_orders.c.assignee_person_id == actor.person_id,
                        post_work_orders.c.assignee_role == actor.person_role,
                    ),
                )
            )
            .order_by(
                post_work_orders.c.due_at.asc().nulls_last(),
                post_work_orders.c.created_at,
                post_work_orders.c.id,
            )
        )
    ).all()
    return {
        "work_orders": [
            {
                **_work_order_value(row),
                "show_id": str(row.show_id),
                "show_title": row.show_title,
                "episode_title": row.episode_title,
                "episode_number": row.episode_number,
                "workflow_stage_name": row.workflow_stage_name,
            }
            for row in rows
        ]
    }


@router.get("/{work_order_id}")
async def get_work_order(work_order_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    work_order = await _work_order_or_404(session, actor, work_order_id)
    if not await _can_access_work_order(session, actor, work_order):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found.")
    item_rows = (
        await session.execute(
            select(post_work_order_items)
            .where(
                and_(
                    post_work_order_items.c.organization_id == actor.organization_id,
                    post_work_order_items.c.work_order_id == work_order_id,
                )
            )
            .order_by(post_work_order_items.c.position, post_work_order_items.c.id)
        )
    ).all()
    return _work_order_value(work_order, item_rows)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_work_order(
    payload: WorkOrderCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_work_orders")
    commercial_fields = {
        "estimated_amount",
        "budget_line_id",
        "client_quote_amount",
        "billing_notes",
        "items",
        "client_purchase_order_id",
    }
    if commercial_fields.intersection(payload.model_fields_set):
        await require_permission(session, actor, "manage_commercial")
    episode = await _validate_create_references(session, actor, payload)
    now = datetime.now(UTC)
    blocking = payload.is_blocking if payload.is_blocking is not None else bool(payload.workflow_stage_id)
    result = await session.execute(
        insert(post_work_orders)
        .values(
            organization_id=actor.organization_id,
            episode_id=episode.id,
            workflow_stage_id=payload.workflow_stage_id,
            booking_id=payload.booking_id,
            work_type=payload.work_type,
            vendor_company_id=payload.vendor_company_id if payload.work_type == "external_vendor" else None,
            purchase_order_id=payload.purchase_order_id if payload.work_type == "external_vendor" else None,
            budget_line_id=payload.budget_line_id if payload.work_type == "external_vendor" else None,
            client_purchase_order_id=payload.client_purchase_order_id,
            kind=payload.kind,
            title=payload.title.strip(),
            description=payload.description.strip() if payload.description else None,
            department=payload.department.strip() if payload.department else None,
            assignee_person_id=payload.assignee_person_id,
            assignee_role=payload.assignee_role.strip() if payload.assignee_role else None,
            priority=payload.priority,
            is_blocking=blocking,
            status="in_progress" if payload.kind == "qc_exception" else "open",
            billing_scope=payload.billing_scope,
            billing_status="draft" if payload.billing_scope == "billable_change" else "not_billable",
            estimated_amount=payload.estimated_amount if payload.work_type == "external_vendor" else None,
            client_quote_amount=payload.client_quote_amount,
            currency=actor.active_organization.currency,
            client_quote_currency=actor.active_organization.currency
            if payload.client_quote_amount is not None
            else None,
            billing_notes=payload.billing_notes.strip() if payload.billing_notes else None,
            external_url=payload.external_url,
            due_at=payload.due_at,
            created_by_user_id=actor.user_id,
            created_at=now,
            updated_at=now,
        )
        .returning(post_work_orders)
    )
    row = result.one()
    for position, item in enumerate(payload.items, start=1):
        await session.execute(
            insert(post_work_order_items).values(
                organization_id=actor.organization_id,
                work_order_id=row.id,
                type=item.type,
                description=item.description.strip(),
                quantity=item.quantity,
                unit=item.unit,
                unit_rate=item.unit_rate,
                discount_percent=item.discount_percent,
                notes=item.notes.strip() if item.notes else None,
                position=position,
                created_at=now,
                updated_at=now,
            )
        )
    await _audit(
        session,
        actor,
        action="work_order.created",
        work_order_id=str(row.id),
        episode_id=str(episode.id),
        metadata={"kind": payload.kind, "workType": payload.work_type, "itemCount": len(payload.items)},
    )
    await session.commit()
    return _work_order_value(row)


@router.patch("/{work_order_id}")
async def update_work_order(
    work_order_id: str, payload: WorkOrderUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    work_order = await _work_order_or_404(session, actor, work_order_id, lock=True)
    may_manage = await has_permission(session, actor, "manage_work_orders")
    may_update_assigned = await has_permission(session, actor, "update_assigned_work")
    is_assigned = bool(
        actor.person_id
        and (work_order.assignee_person_id == actor.person_id or work_order.assignee_role == actor.person_role)
    )
    if not may_manage and not (may_update_assigned and is_assigned):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only update work assigned to you.")

    manager_fields = {
        "episode_id",
        "title",
        "description",
        "department",
        "assignee_person_id",
        "assignee_role",
        "work_type",
        "vendor_company_id",
        "purchase_order_id",
        "budget_line_id",
        "client_purchase_order_id",
        "billing_scope",
        "estimated_amount",
        "client_quote_amount",
        "billing_notes",
        "priority",
        "is_blocking",
        "external_url",
        "due_at",
    }
    if not may_manage and manager_fields.intersection(payload.model_fields_set):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only post management can change work-order details."
        )
    commercial_fields = {
        "episode_id",
        "work_type",
        "vendor_company_id",
        "purchase_order_id",
        "budget_line_id",
        "estimated_amount",
        "client_purchase_order_id",
        "billing_scope",
        "client_quote_amount",
        "billing_notes",
    }
    changing_commercial_fields = commercial_fields.intersection(payload.model_fields_set)
    if work_order.billing_status == "posted" and changing_commercial_fields:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Posted billable work cannot have its commercial terms changed.",
        )
    if changing_commercial_fields:
        await require_permission(session, actor, "manage_commercial")
    if payload.assignee_person_id is not None:
        await _tenant_record(session, people, actor, payload.assignee_person_id, "Assigned person")
    if payload.is_blocking and not work_order.workflow_stage_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A blocking work order must be linked to a workflow stage."
        )

    fields = payload.model_fields_set
    episode = await _episode_scope(session, actor, str(work_order.episode_id))
    episode_changed = bool(payload.episode_id and payload.episode_id != str(work_order.episode_id))
    if episode_changed:
        if work_order.booking_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Move or cancel the linked room booking before moving this work order to another episode.",
            )
        if work_order.billing_status == "posted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A posted client charge cannot move episodes. Void it before changing commercial scope.",
            )
        has_actual = await session.scalar(
            select(func.count()).select_from(vendor_invoices).where(
                and_(
                    vendor_invoices.c.organization_id == actor.organization_id,
                    vendor_invoices.c.work_order_id == work_order_id,
                    vendor_invoices.c.status != "void",
                )
            )
        )
        if has_actual:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A work order with supplier actuals cannot move episodes; correct the supplier invoice instead.",
            )
        episode = await _episode_scope(session, actor, payload.episode_id)
    next_work_type = payload.work_type if "work_type" in fields else work_order.work_type
    next_vendor_company_id = (
        payload.vendor_company_id
        if "vendor_company_id" in fields
        else (str(work_order.vendor_company_id) if work_order.vendor_company_id else None)
    )
    next_purchase_order_id = (
        payload.purchase_order_id
        if "purchase_order_id" in fields
        else (str(work_order.purchase_order_id) if work_order.purchase_order_id else None)
    )
    next_budget_line_id = (
        payload.budget_line_id
        if "budget_line_id" in fields
        else (str(work_order.budget_line_id) if work_order.budget_line_id else None)
    )
    next_estimated_amount = payload.estimated_amount if "estimated_amount" in fields else work_order.estimated_amount
    next_billing_scope = payload.billing_scope if "billing_scope" in fields else work_order.billing_scope
    next_client_purchase_order_id = (
        payload.client_purchase_order_id
        if "client_purchase_order_id" in fields
        else (str(work_order.client_purchase_order_id) if work_order.client_purchase_order_id else None)
    )
    next_client_quote_amount = (
        payload.client_quote_amount if "client_quote_amount" in fields else work_order.client_quote_amount
    )
    next_billing_notes = payload.billing_notes if "billing_notes" in fields else work_order.billing_notes
    selected_order = None
    selected_client_order = None
    if next_work_type == "internal":
        if (
            ("vendor_company_id" in fields and payload.vendor_company_id)
            or ("purchase_order_id" in fields and payload.purchase_order_id)
            or ("budget_line_id" in fields and payload.budget_line_id)
            or ("estimated_amount" in fields and payload.estimated_amount is not None)
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Internal work cannot include a vendor, PO, or vendor estimate.",
            )
        next_vendor_company_id = None
        next_purchase_order_id = None
        next_budget_line_id = None
        next_estimated_amount = None
    elif next_work_type == "external_vendor":
        if not next_vendor_company_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Choose a vendor for external work.",
            )
        selected_order = await _validate_external_vendor_scope(
            session,
            actor,
            episode=episode,
            vendor_company_id=next_vendor_company_id,
            purchase_order_id=next_purchase_order_id,
            require_approved_po=bool(
                {"episode_id", "work_type", "vendor_company_id", "purchase_order_id", "estimated_amount"}.intersection(fields)
                or (work_order.status == "awaiting_approval" and payload.status == "in_progress")
            ),
        )
        if next_budget_line_id:
            await external_budget_line_for_episode(
                session,
                organization_id=actor.organization_id,
                episode_id=str(episode.id),
                budget_line_id=next_budget_line_id,
                purchase_order_id=next_purchase_order_id,
            )

    if next_client_purchase_order_id and (next_work_type != "internal" or next_billing_scope != "billable_change"):
        if "client_purchase_order_id" in fields and payload.client_purchase_order_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A client PO is only available for internal client-billable work.",
            )
        # Converting approved work to vendor or non-billable work releases the
        # client authorisation automatically rather than leaving a phantom hold.
        next_client_purchase_order_id = None
    if next_client_purchase_order_id:
        if _decimal(next_client_quote_amount) <= 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Add a quoted client amount before selecting a client PO.",
            )
        selected_client_order = await _validate_client_purchase_order_scope(
            session,
            actor,
            episode=episode,
            client_purchase_order_id=next_client_purchase_order_id,
        )

    next_status = payload.status or work_order.status
    approval_decision = (
        work_order.kind != "qc_exception"
        and work_order.status == "awaiting_approval"
        and payload.status in {"in_progress", "rejected"}
    )
    approval_transition = approval_decision and payload.status == "in_progress"
    if payload.approval_note is not None and not approval_decision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An approval note can only be added when approving or returning submitted work.",
        )
    if payload.status:
        if work_order.status in {"open", "rejected"}:
            if not may_manage or payload.status not in {"awaiting_approval", "cancelled"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Submit this work order for approval before work can begin.",
                )
        elif work_order.status == "awaiting_approval":
            if not may_manage or payload.status not in {"in_progress", "rejected", "cancelled"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Submitted work can only be approved, returned for changes, or cancelled.",
                )
        elif work_order.status == "in_progress":
            if payload.status not in {"ready_for_review", "complete", "cancelled"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Approved work can only be completed, reviewed, or cancelled.",
                )
        elif work_order.status == "ready_for_review":
            if payload.status not in {"in_progress", "complete", "cancelled"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Review work must be completed or resumed."
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="A completed or cancelled work order cannot be changed."
            )
        if work_order.kind == "qc_exception" and payload.status == "complete":
            await require_permission(session, actor, "verify_qc")

        # Internal assigned work consumes post-house time. It must first be
        # placed on the facility calendar, rather than being completed as an
        # off-calendar task. External vendor work remains intentionally free
        # of this gate because it does not reserve a post-house room.
        if payload.status in {"ready_for_review", "complete"} and work_order.work_type == "internal":
            if not work_order.booking_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Place a room booking for this internal work order before completing it.",
                )
            linked_booking = await _tenant_record(
                session, bookings, actor, str(work_order.booking_id), "Linked booking"
            )
            if linked_booking and linked_booking.status == "cancelled":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "The linked room booking was cancelled. Place a new booking before completing this work order."
                    ),
                )

    existing_commitments = await _existing_po_commitments(session, actor, work_order_id)
    existing_client_commitments = await _existing_client_po_commitments(session, actor, work_order_id)
    commercial_changed = bool(commercial_fields.intersection(fields))
    should_release_commitment = bool(
        existing_commitments
        and (next_status == "cancelled" or next_work_type != "external_vendor" or not next_purchase_order_id)
    )
    should_sync_commitment = bool(
        next_work_type == "external_vendor"
        and selected_order
        and next_status != "cancelled"
        and (
            episode_changed
            or approval_transition
            or (commercial_changed and work_order.status in {"in_progress", "ready_for_review", "complete"})
        )
    )
    should_release_client_commitment = bool(
        existing_client_commitments
        and (
            next_status == "cancelled"
            or next_work_type != "internal"
            or next_billing_scope != "billable_change"
            or not next_client_purchase_order_id
        )
    )
    should_sync_client_commitment = bool(
        next_work_type == "internal"
        and next_billing_scope == "billable_change"
        and selected_client_order
        and next_status != "cancelled"
        and (
            episode_changed
            or approval_transition
            or (commercial_changed and work_order.status in {"in_progress", "ready_for_review", "complete"})
        )
    )
    if payload.overrun_reason is not None and not should_sync_commitment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A PO overrun reason can only be added when approving or changing an active PO commitment.",
        )
    if payload.client_po_overrun_reason is not None and not should_sync_client_commitment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A client PO overrun reason can only be added when approving or changing billable work.",
        )
    commitment_plan = None
    if should_sync_commitment:
        commitment_plan = await _plan_po_commitment(
            session,
            actor,
            work_order=work_order,
            order=selected_order,
            estimated_amount=next_estimated_amount,
            existing=existing_commitments,
            overrun_reason=payload.overrun_reason,
        )
        if commitment_plan["overrun"] > 0:
            await require_permission(session, actor, "approve_budget_overruns")
    client_commitment_plan = None
    if should_sync_client_commitment:
        # A client PO reservation is a commercial commitment even if the
        # status transition itself is performed by production management.
        await require_permission(session, actor, "manage_commercial")
        client_commitment_plan = await _plan_client_po_commitment(
            session,
            actor,
            work_order=work_order,
            order=selected_client_order,
            client_quote_amount=next_client_quote_amount,
            existing=existing_client_commitments,
            overrun_reason=payload.client_po_overrun_reason,
        )
        if client_commitment_plan["overrun"] > 0:
            await require_permission(session, actor, "approve_budget_overruns")

    now = datetime.now(UTC)
    values = payload.model_dump(exclude_unset=True)
    values.pop("approval_note", None)
    values.pop("overrun_reason", None)
    values.pop("client_po_overrun_reason", None)
    for field in (
        "work_type",
        "vendor_company_id",
        "purchase_order_id",
        "budget_line_id",
        "estimated_amount",
        "client_purchase_order_id",
        "billing_scope",
        "client_quote_amount",
        "billing_notes",
    ):
        values.pop(field, None)
    values["updated_at"] = now
    values.update(
        {
            "episode_id": str(episode.id),
            "work_type": next_work_type,
            "vendor_company_id": next_vendor_company_id,
            "purchase_order_id": next_purchase_order_id,
            "budget_line_id": next_budget_line_id,
            "estimated_amount": next_estimated_amount,
            "client_purchase_order_id": next_client_purchase_order_id,
            "billing_scope": next_billing_scope,
            "client_quote_amount": next_client_quote_amount,
            "client_quote_currency": actor.active_organization.currency
            if next_client_quote_amount is not None
            else None,
            "billing_notes": next_billing_notes.strip() if next_billing_notes else None,
        }
    )
    if "billing_scope" in fields:
        values["billing_status"] = "draft" if next_billing_scope == "billable_change" else "not_billable"
    if approval_transition:
        values["approved_by_person_id"] = actor.person_id
        values["approved_at"] = now
        values["approval_note"] = payload.approval_note.strip() if payload.approval_note else None
    if payload.status == "complete":
        values["completed_by_person_id"] = actor.person_id
        values["completed_at"] = now
    elif payload.status:
        values["completed_by_person_id"] = None
        values["completed_at"] = None
    changed = await session.execute(
        update(post_work_orders)
        .where(
            and_(
                post_work_orders.c.id == work_order_id,
                post_work_orders.c.organization_id == actor.organization_id,
            )
        )
        .values(**values)
        .returning(post_work_orders)
    )
    row = changed.one()
    allocation_id, released_commitments = (
        await _apply_po_commitment(
            session,
            actor,
            work_order_id=work_order_id,
            existing=existing_commitments,
            plan=commitment_plan if should_sync_commitment else None,
            now=now,
        )
        if (should_sync_commitment or should_release_commitment)
        else (None, [])
    )
    client_allocation_id, released_client_commitments = (
        await _apply_client_po_commitment(
            session,
            actor,
            work_order_id=work_order_id,
            existing=existing_client_commitments,
            plan=client_commitment_plan if should_sync_client_commitment else None,
            now=now,
        )
        if (should_sync_client_commitment or should_release_client_commitment)
        else (None, [])
    )

    if commitment_plan:
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action=(
                    "purchase_order.work_order_overrun_authorised"
                    if commitment_plan["overrun"] > 0
                    else "purchase_order.work_order_committed"
                ),
                entity_type="purchase_order",
                entity_id=commitment_plan["purchase_order_id"],
                metadata={
                    "workOrderId": work_order_id,
                    "allocationId": allocation_id,
                    "amount": str(commitment_plan["amount"]),
                    "overrunAmount": str(commitment_plan["overrun"]),
                    "overrunReason": commitment_plan["overrun_reason"],
                },
            )
        )
    target_po_id = commitment_plan["purchase_order_id"] if commitment_plan else None
    released_po_ids = {
        str(item.purchase_order_id) for item in released_commitments if str(item.purchase_order_id) != target_po_id
    }
    for released_po_id in released_po_ids:
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action="purchase_order.work_order_commitment_released",
                entity_type="purchase_order",
                entity_id=released_po_id,
                metadata={"workOrderId": work_order_id},
            )
        )
    if client_commitment_plan:
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action=(
                    "client_purchase_order.work_order_overrun_authorised"
                    if client_commitment_plan["overrun"] > 0
                    else "client_purchase_order.work_order_committed"
                ),
                entity_type="client_purchase_order",
                entity_id=client_commitment_plan["client_purchase_order_id"],
                metadata={
                    "workOrderId": work_order_id,
                    "allocationId": client_allocation_id,
                    "amount": str(client_commitment_plan["amount"]),
                    "overrunAmount": str(client_commitment_plan["overrun"]),
                    "overrunReason": client_commitment_plan["overrun_reason"],
                },
            )
        )
    target_client_po_id = client_commitment_plan["client_purchase_order_id"] if client_commitment_plan else None
    released_client_po_ids = {
        str(item.client_purchase_order_id)
        for item in released_client_commitments
        if str(item.client_purchase_order_id) != target_client_po_id
    }
    for released_client_po_id in released_client_po_ids:
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action="client_purchase_order.work_order_commitment_released",
                entity_type="client_purchase_order",
                entity_id=released_client_po_id,
                metadata={"workOrderId": work_order_id},
            )
        )
    action = (
        "work_order.completed"
        if next_status == "complete"
        else "work_order.approved"
        if approval_transition
        else "work_order.returned"
        if approval_decision
        else "work_order.submitted"
        if next_status == "awaiting_approval"
        else "work_order.updated"
    )
    await _audit(
        session,
        actor,
        action=action,
        work_order_id=work_order_id,
        episode_id=str(row.episode_id),
        metadata={
            "status": next_status,
            "clientPurchaseOrderId": next_client_purchase_order_id,
            "clientPoAllocationId": client_allocation_id,
        },
    )
    await session.commit()
    return _work_order_value(row)


@router.post("/{work_order_id}/booking", status_code=status.HTTP_201_CREATED)
async def reserve_work_order_room(
    work_order_id: str, payload: WorkOrderBookingRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Turn active internal work into a protected facility reservation.

    A reservation is intentionally a normal booking. The Gantt calendar sees
    it immediately, so a quick artist task cannot be displaced by a later
    producer booking.
    """
    work_order = await _work_order_or_404(session, actor, work_order_id)
    may_manage = await has_permission(session, actor, "manage_production")
    may_record_time = await has_permission(session, actor, "update_assigned_work")
    is_assigned = bool(
        actor.person_id
        and (work_order.assignee_person_id == actor.person_id or work_order.assignee_role == actor.person_role)
    )
    if not may_manage and not (may_record_time and is_assigned):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only schedule work assigned to you.")
    if work_order.work_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only internal work orders can reserve post-house rooms.",
        )
    if work_order.status not in {"in_progress", "ready_for_review"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Start this work order before reserving time."
        )
    if work_order.booking_id:
        linked = await _tenant_record(session, bookings, actor, str(work_order.booking_id), "Linked booking")
        if linked and linked.status != "cancelled":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This work order already has a calendar booking."
            )
    room = await _tenant_record(session, rooms, actor, payload.room_id, "Room")
    booking_type = {
        "edit_bay": "edit",
        "color_suite": "color",
        "mix_room": "mix",
        "qc_room": "qc",
    }.get(room.type)
    if not booking_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This room cannot be reserved for a work order."
        )
    person_id = work_order.assignee_person_id or actor.person_id
    if not person_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assign a person before reserving this work.")
    existing = (
        await session.execute(
            select(bookings).where(
                and_(
                    bookings.c.organization_id == actor.organization_id,
                    bookings.c.status != "cancelled",
                    or_(bookings.c.room_id == room.id, bookings.c.person_id == person_id),
                )
            )
        )
    ).all()
    candidate = {
        "room_id": room.id,
        "person_id": person_id,
        "starts_at": payload.starts_at,
        "ends_at": payload.ends_at,
        "setup_minutes": 0,
        "handover_minutes": 0,
        "status": "confirmed",
        "is_option": False,
    }
    conflicts = booking_conflicts([dict(row._mapping) for row in existing], candidate, include_options=False)
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "The room or assigned artist is already booked at this time.",
                "conflicts": [
                    {
                        "id": str(conflict["id"]),
                        "title": conflict["title"],
                        "overlaps": conflict["overlaps"],
                    }
                    for conflict in conflicts
                ],
            },
        )

    now = datetime.now(UTC)
    budget_item = (
        await session.execute(
            select(budget_lines.c.id).where(
                and_(
                    budget_lines.c.organization_id == actor.organization_id,
                    budget_lines.c.work_order_id == work_order.id,
                    budget_lines.c.episode_id == work_order.episode_id,
                    budget_lines.c.external_cost.is_(False),
                )
            ).limit(1)
        )
    ).first()
    created = await session.execute(
        insert(bookings)
        .values(
            organization_id=actor.organization_id,
            room_id=room.id,
            episode_id=work_order.episode_id,
            budget_line_id=budget_item.id if budget_item else None,
            person_id=person_id,
            title=f"Work order · {work_order.title}"[:160],
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            setup_minutes=0,
            handover_minutes=0,
            approved_overtime_minutes=0,
            is_option=False,
            status="confirmed",
            booking_type=booking_type,
            notes=payload.notes.strip() if payload.notes else "Reserved from assigned work order.",
            created_at=now,
            updated_at=now,
        )
        .returning(bookings.c.id)
    )
    booking_id = str(created.scalar_one())
    # Guard the link update as well: serial client requests must not attach two
    # facility bookings to one work order.
    link_conditions = [
        post_work_orders.c.id == work_order_id,
        post_work_orders.c.organization_id == actor.organization_id,
    ]
    if work_order.booking_id:
        link_conditions.append(post_work_orders.c.booking_id == work_order.booking_id)
    else:
        link_conditions.append(post_work_orders.c.booking_id.is_(None))
    link_values: dict[str, object] = {"booking_id": booking_id, "updated_at": now}
    # A legacy/reopened work order may have been marked ready for review before
    # it was placed on the calendar. Reserving facility time resumes it so the
    # artist can complete the operational sequence normally.
    if work_order.status == "ready_for_review":
        link_values["status"] = "in_progress"
    linked = await session.execute(
        update(post_work_orders)
        .where(and_(*link_conditions))
        .values(**link_values)
        .returning(post_work_orders.c.id)
    )
    if not linked.first():
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This work order was just reserved by another booking."
        )
    await _audit(
        session,
        actor,
        action="work_order.booking_scheduled",
        work_order_id=work_order_id,
        episode_id=str(work_order.episode_id),
        metadata={
            "bookingId": booking_id,
            "roomId": str(room.id),
            "resumedFromReview": work_order.status == "ready_for_review",
        },
    )
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="booking.created_from_work_order",
            entity_type="booking",
            entity_id=booking_id,
            metadata={
                "workOrderId": work_order_id,
                "episodeId": str(work_order.episode_id),
                "budgetLineId": str(budget_item.id) if budget_item else None,
            },
        )
    )
    await session.commit()
    return {"id": booking_id, "work_order_id": work_order_id}
