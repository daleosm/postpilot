"""Tenant-scoped vendor purchase-order register and allocation ledger."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, case, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    PurchaseOrderActualCostRequest,
    PurchaseOrderAllocationRequest,
    PurchaseOrderCreateRequest,
    PurchaseOrderUpdateRequest,
)
from app.auth import require_any_permission, require_permission
from app.budget_actuals import record_budget_actual
from app.db.tables import (
    activity_log,
    budget_lines,
    crm_companies,
    episodes,
    post_work_orders,
    purchase_order_allocations,
    purchase_orders,
    seasons,
    shows,
    users,
    vendor_invoices,
)
from app.purchase_order_logic import balance_snapshot, valid_status_transition
from app.vendor_spend import external_budget_line_for_episode

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])


def _decimal(value: object | None) -> Decimal:
    return Decimal(str(value or 0))


def _currency(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


async def _audit(
    session: DbSession, actor: CurrentActor, action: str, purchase_order_id: str, metadata: dict[str, object]
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type="purchase_order",
            entity_id=purchase_order_id,
            metadata=metadata,
        )
    )


async def _order_or_404(session: DbSession, actor: CurrentActor, purchase_order_id: str) -> object:
    row = (
        await session.execute(
            select(purchase_orders)
            .where(
                and_(
                    purchase_orders.c.id == purchase_order_id,
                    purchase_orders.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")
    return row


async def _scope(
    session: DbSession,
    actor: CurrentActor,
    *,
    vendor_company_id: str,
    show_id: str | None,
    episode_id: str | None,
) -> tuple[str | None, str | None]:
    vendor = (
        await session.execute(
            select(crm_companies.c.id, crm_companies.c.type).where(
                and_(crm_companies.c.id == vendor_company_id, crm_companies.c.organization_id == actor.organization_id)
            )
        )
    ).first()
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found.")
    if vendor.type != "vendor":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The selected company is not a vendor account."
        )
    if show_id:
        show = (
            await session.execute(
                select(shows.c.id).where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
            )
        ).first()
        if not show:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    episode_show_id = None
    if episode_id:
        episode = (
            await session.execute(
                select(episodes.c.id, seasons.c.show_id)
                .join(
                    seasons,
                    and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
                )
                .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            )
        ).first()
        if not episode:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
        episode_show_id = str(episode.show_id)
    if show_id and episode_show_id and show_id != episode_show_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected episode does not belong to the selected show.",
        )
    return episode_show_id or show_id, episode_id


async def _totals(session: DbSession, actor: CurrentActor, purchase_order_id: str) -> tuple[Decimal, Decimal]:
    row = (
        await session.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                purchase_order_allocations.c.allocation_type.in_(("work_order", "budget_line")),
                                purchase_order_allocations.c.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("committed"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                purchase_order_allocations.c.allocation_type == "vendor_invoice",
                                purchase_order_allocations.c.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("actual"),
            ).where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.purchase_order_id == purchase_order_id,
                )
            )
        )
    ).one()
    return _decimal(row.committed), _decimal(row.actual)


async def _detail(session: DbSession, actor: CurrentActor, purchase_order_id: str) -> dict[str, object]:
    order = await _order_or_404(session, actor, purchase_order_id)
    committed, actual = await _totals(session, actor, purchase_order_id)
    balance = balance_snapshot(_decimal(order.approved_amount), committed, actual)
    vendor_name = (
        await session.execute(
            select(crm_companies.c.name).where(
                and_(
                    crm_companies.c.id == order.vendor_company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                )
            )
        )
    ).scalar_one_or_none()
    show = None
    if order.show_id:
        show = (
            await session.execute(
                select(shows.c.title).where(
                    and_(shows.c.id == order.show_id, shows.c.organization_id == actor.organization_id)
                )
            )
        ).first()
    episode = None
    if order.episode_id:
        episode = (
            await session.execute(
                select(episodes.c.number, episodes.c.title).where(
                    and_(episodes.c.id == order.episode_id, episodes.c.organization_id == actor.organization_id)
                )
            )
        ).first()
    allocations = (
        await session.execute(
            select(
                purchase_order_allocations,
                vendor_invoices.c.external_document_url,
            )
            .outerjoin(
                vendor_invoices,
                and_(
                    vendor_invoices.c.id == purchase_order_allocations.c.vendor_invoice_id,
                    vendor_invoices.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.purchase_order_id == purchase_order_id,
                )
            )
            .order_by(
                purchase_order_allocations.c.allocation_date.desc(), purchase_order_allocations.c.created_at.desc()
            )
        )
    ).all()
    activity = (
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
                    activity_log.c.organization_id == actor.organization_id,
                    activity_log.c.entity_type == "purchase_order",
                    activity_log.c.entity_id == purchase_order_id,
                )
            )
            .order_by(activity_log.c.created_at.desc())
            .limit(30)
        )
    ).all()
    return {
        "id": str(order.id),
        "vendor_company_id": str(order.vendor_company_id),
        "vendor_name": vendor_name,
        "show_id": str(order.show_id) if order.show_id else None,
        "show_title": show.title if show else None,
        "episode_id": str(order.episode_id) if order.episode_id else None,
        "episode_number": episode.number if episode else None,
        "episode_title": episode.title if episode else None,
        "po_number": order.po_number,
        "currency": order.currency,
        "issue_date": order.issue_date,
        "expiry_date": order.expiry_date,
        "status": order.status,
        "notes": order.notes,
        "external_document_url": order.external_document_url,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        **{key: _currency(value) for key, value in balance.items()},
        "allocations": [
            {
                "id": str(item.id),
                "allocation_type": item.allocation_type,
                "work_order_id": str(item.work_order_id) if item.work_order_id else None,
                "budget_line_id": str(item.budget_line_id) if item.budget_line_id else None,
                "amount": _currency(_decimal(item.amount)),
                "allocation_date": item.allocation_date,
                "reference": item.reference,
                "description": item.description,
                "external_document_url": item.external_document_url,
                "created_at": item.created_at,
            }
            for item in allocations
        ],
        "activity": [
            {
                "id": str(event.id),
                "action": event.action,
                "metadata": event.metadata,
                "created_at": event.created_at,
                "actor_name": event.actor_name,
            }
            for event in activity
        ],
    }


@router.get("")
async def list_purchase_orders(
    actor: CurrentActor,
    session: DbSession,
    vendor_id: str | None = Query(default=None, alias="vendorId"),
    episode_id: str | None = Query(default=None, alias="episodeId"),
) -> dict[str, object]:
    """List the register or server-filtered PO choices for one work order."""
    if bool(vendor_id) != bool(episode_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose both a vendor and an episode when filtering purchase orders.",
        )
    if vendor_id and episode_id:
        await require_any_permission(session, actor, "manage_work_orders", "manage_budget")
        episode = (
            await session.execute(
                select(episodes.c.id, seasons.c.show_id)
                .join(
                    seasons,
                    and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
                )
                .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
                .limit(1)
            )
        ).first()
        if not episode:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
        ids = (
            (
                await session.execute(
                    select(purchase_orders.c.id)
                    .where(
                        and_(
                            purchase_orders.c.organization_id == actor.organization_id,
                            purchase_orders.c.vendor_company_id == vendor_id,
                            purchase_orders.c.status == "approved",
                            or_(purchase_orders.c.show_id.is_(None), purchase_orders.c.show_id == episode.show_id),
                            or_(purchase_orders.c.episode_id.is_(None), purchase_orders.c.episode_id == episode_id),
                        )
                    )
                    .order_by(purchase_orders.c.expiry_date, purchase_orders.c.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return {"purchase_orders": [await _detail(session, actor, str(purchase_order_id)) for purchase_order_id in ids]}

    await require_permission(session, actor, "manage_budget")
    ids = (
        (
            await session.execute(
                select(purchase_orders.c.id)
                .where(purchase_orders.c.organization_id == actor.organization_id)
                .order_by(purchase_orders.c.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return {"purchase_orders": [await _detail(session, actor, str(purchase_order_id)) for purchase_order_id in ids]}


@router.get("/{purchase_order_id}")
async def get_purchase_order(purchase_order_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_budget")
    return await _detail(session, actor, purchase_order_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    payload: PurchaseOrderCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_budget")
    if payload.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a budget approver can approve, close, or cancel a PO.",
        )
    show_id, episode_id = await _scope(
        session,
        actor,
        vendor_company_id=payload.vendor_company_id,
        show_id=payload.show_id,
        episode_id=payload.episode_id,
    )
    now = datetime.now(UTC)
    try:
        created = await session.execute(
            insert(purchase_orders)
            .values(
                organization_id=actor.organization_id,
                vendor_company_id=payload.vendor_company_id,
                show_id=show_id,
                episode_id=episode_id,
                po_number=payload.po_number.strip(),
                currency=actor.active_organization.currency,
                approved_amount=payload.approved_amount,
                issue_date=payload.issue_date,
                expiry_date=payload.expiry_date,
                status="draft",
                notes=payload.notes.strip() if payload.notes else None,
                external_document_url=payload.external_document_url,
                created_by_user_id=actor.user_id,
                created_at=now,
                updated_at=now,
            )
            .returning(purchase_orders.c.id)
        )
        purchase_order_id = str(created.scalar_one())
        await _audit(
            session, actor, "purchase_order.created", purchase_order_id, {"poNumber": payload.po_number.strip()}
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A PO with that number already exists in this post house."
        ) from error
    return await _detail(session, actor, purchase_order_id)


@router.patch("/{purchase_order_id}")
async def update_purchase_order(
    purchase_order_id: str, payload: PurchaseOrderUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    order = await _order_or_404(session, actor, purchase_order_id)
    fields = payload.model_fields_set
    status_change = payload.status is not None and payload.status != order.status
    editable = fields - {"status"}
    if status_change:
        await require_permission(session, actor, "approve_budget_overruns")
        if not valid_status_transition(order.status, payload.status):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="That PO status transition is not allowed."
            )
    if editable:
        await require_permission(session, actor, "manage_budget")
        if order.status != "draft":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft POs can be edited.")
    values: dict[str, object] = {"updated_at": datetime.now(UTC)}
    if editable:
        effective_issue_date = payload.issue_date if "issue_date" in fields else order.issue_date
        effective_expiry_date = payload.expiry_date if "expiry_date" in fields else order.expiry_date
        if effective_issue_date and effective_expiry_date and effective_expiry_date < effective_issue_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Expiry date cannot be before the issue date."
            )
        show_id, episode_id = await _scope(
            session,
            actor,
            vendor_company_id=payload.vendor_company_id or str(order.vendor_company_id),
            show_id=payload.show_id if "show_id" in fields else (str(order.show_id) if order.show_id else None),
            episode_id=payload.episode_id
            if "episode_id" in fields
            else (str(order.episode_id) if order.episode_id else None),
        )
        values.update(
            {
                "vendor_company_id": payload.vendor_company_id or str(order.vendor_company_id),
                "show_id": show_id,
                "episode_id": episode_id,
            }
        )
        for field in ("po_number", "approved_amount", "issue_date", "expiry_date", "notes", "external_document_url"):
            if field in fields:
                values[field] = getattr(payload, field)
    if status_change:
        values["status"] = payload.status
    try:
        await session.execute(
            update(purchase_orders)
            .where(
                and_(
                    purchase_orders.c.id == purchase_order_id,
                    purchase_orders.c.organization_id == actor.organization_id,
                )
            )
            .values(**values)
        )
        await _audit(
            session,
            actor,
            f"purchase_order.{payload.status}" if status_change else "purchase_order.updated",
            purchase_order_id,
            {"poNumber": values.get("po_number", order.po_number)},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A PO with that number already exists in this post house."
        ) from error
    return await _detail(session, actor, purchase_order_id)


@router.post("/{purchase_order_id}/allocations", status_code=status.HTTP_201_CREATED)
async def create_purchase_order_allocation(
    purchase_order_id: str, payload: PurchaseOrderAllocationRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_budget")
    order = await _order_or_404(session, actor, purchase_order_id)
    if order.status != "approved":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only approved POs can receive allocations.")
    if payload.allocation_type == "work_order":
        source = (
            await session.execute(
                select(
                    post_work_orders.c.id,
                    post_work_orders.c.vendor_company_id,
                    post_work_orders.c.episode_id,
                    post_work_orders.c.status,
                    seasons.c.show_id,
                )
                .join(episodes, episodes.c.id == post_work_orders.c.episode_id)
                .join(seasons, seasons.c.id == episodes.c.season_id)
                .where(
                    and_(
                        post_work_orders.c.id == payload.work_order_id,
                        post_work_orders.c.organization_id == actor.organization_id,
                    )
                )
                # Serialise direct manual allocations with the work-order
                # approval path. The duplicate check below then sees a
                # commitment just made by another request instead of allowing
                # the same work order to consume two POs.
                .with_for_update()
            )
        ).first()
        source_id = payload.work_order_id
        if source and source.status not in {"in_progress", "complete"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Only approved or completed work orders can consume a PO."
            )
    elif payload.allocation_type == "budget_line":
        source = (
            await session.execute(
                select(
                    budget_lines.c.id, budget_lines.c.show_id, budget_lines.c.episode_id, budget_lines.c.external_cost
                ).where(
                    and_(
                        budget_lines.c.id == payload.budget_line_id,
                        budget_lines.c.organization_id == actor.organization_id,
                    )
                )
            )
        ).first()
        source_id = payload.budget_line_id
        if source and not source.external_cost:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only external-cost budget lines can consume a purchase order.",
            )
    else:
        source = (
            await session.execute(
                select(
                    vendor_invoices.c.id,
                    vendor_invoices.c.vendor_company_id,
                    vendor_invoices.c.show_id,
                    vendor_invoices.c.episode_id,
                ).where(
                    and_(
                        vendor_invoices.c.id == payload.vendor_invoice_id,
                        vendor_invoices.c.organization_id == actor.organization_id,
                    )
                )
            )
        ).first()
        source_id = payload.vendor_invoice_id
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation source not found.")
    if getattr(source, "vendor_company_id", None) and source.vendor_company_id != order.vendor_company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The allocation source belongs to a different vendor."
        )
    if order.show_id and source.show_id != order.show_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The allocation source belongs to a different show."
        )
    if order.episode_id and source.episode_id != order.episode_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The allocation source belongs to a different episode."
        )
    duplicate_filter = {
        "work_order": purchase_order_allocations.c.work_order_id == source_id,
        "budget_line": purchase_order_allocations.c.budget_line_id == source_id,
        "vendor_invoice": purchase_order_allocations.c.vendor_invoice_id == source_id,
    }[payload.allocation_type]
    duplicate = (
        await session.execute(
            select(purchase_order_allocations.c.id).where(
                and_(purchase_order_allocations.c.organization_id == actor.organization_id, duplicate_filter)
            )
        )
    ).first()
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This source already has a PO commitment.")
    committed, actual = await _totals(session, actor, purchase_order_id)
    proposed = (
        actual + _decimal(payload.amount)
        if payload.allocation_type == "vendor_invoice"
        else committed + _decimal(payload.amount)
    )
    overrun = max(Decimal(0), proposed - _decimal(order.approved_amount))
    if overrun > 0 and not payload.overrun_reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Explain the PO overrun before authorising it."
        )
    allocation = await session.execute(
        insert(purchase_order_allocations)
        .values(
            organization_id=actor.organization_id,
            purchase_order_id=purchase_order_id,
            allocation_type=payload.allocation_type,
            work_order_id=payload.work_order_id,
            budget_line_id=payload.budget_line_id,
            vendor_invoice_id=payload.vendor_invoice_id,
            amount=payload.amount,
            allocation_date=payload.allocation_date,
            reference=payload.reference.strip() if payload.reference else None,
            description=payload.description.strip() if payload.description else None,
            created_by_user_id=actor.user_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        .returning(purchase_order_allocations.c.id)
    )
    if payload.allocation_type == "budget_line":
        await session.execute(
            update(budget_lines)
            .where(
                and_(
                    budget_lines.c.id == payload.budget_line_id, budget_lines.c.organization_id == actor.organization_id
                )
            )
            .values(purchase_order_id=purchase_order_id)
        )
    allocation_id = str(allocation.scalar_one())
    await _audit(
        session,
        actor,
        "purchase_order.overrun_authorised" if overrun > 0 else "purchase_order.allocated",
        purchase_order_id,
        {"allocationId": allocation_id, "allocationType": payload.allocation_type, "amount": payload.amount},
    )
    await session.commit()
    return await _detail(session, actor, purchase_order_id)


@router.post("/{purchase_order_id}/actual-costs", status_code=status.HTTP_201_CREATED)
async def record_purchase_order_actual_cost(
    purchase_order_id: str, payload: PurchaseOrderActualCostRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Record a supplier actual without modelling accounts-payable or payment."""
    await require_permission(session, actor, "manage_budget")
    order = await _order_or_404(session, actor, purchase_order_id)
    if order.status not in {"approved", "closed"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Supplier actuals can only be recorded against an approved or closed PO.",
        )
    episode_id = str(order.episode_id) if order.episode_id else payload.episode_id
    if order.episode_id and payload.episode_id and str(order.episode_id) != payload.episode_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This PO is restricted to a different episode."
        )
    if not episode_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Choose an episode for this supplier actual."
        )
    episode = (
        await session.execute(
            select(episodes.c.id, seasons.c.id.label("season_id"), seasons.c.show_id)
            .join(
                seasons, and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id)
            )
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    if order.show_id and order.show_id != episode.show_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Choose an episode from this PO's show.")
    budget_line = await external_budget_line_for_episode(
        session,
        organization_id=actor.organization_id,
        episode_id=str(episode.id),
        budget_line_id=payload.budget_line_id,
        purchase_order_id=purchase_order_id,
    )
    if not budget_line.purchase_order_id:
        await session.execute(
            update(budget_lines)
            .where(
                and_(
                    budget_lines.c.id == budget_line.id,
                    budget_lines.c.organization_id == actor.organization_id,
                )
            )
            .values(purchase_order_id=purchase_order_id, updated_at=datetime.now(UTC))
        )
    _, actual = await _totals(session, actor, purchase_order_id)
    overrun = max(Decimal(0), actual + _decimal(payload.amount) - _decimal(order.approved_amount))
    if overrun > 0:
        if not payload.overrun_reason:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Explain the PO overrun before authorising it."
            )
        await require_permission(session, actor, "approve_budget_overruns")
    now = datetime.now(UTC)
    try:
        invoice = await session.execute(
            insert(vendor_invoices)
            .values(
                organization_id=actor.organization_id,
                vendor_company_id=order.vendor_company_id,
                show_id=episode.show_id,
                episode_id=episode.id,
                budget_line_id=budget_line.id,
                invoice_number=payload.invoice_number.strip(),
                description=payload.description.strip(),
                amount=payload.amount,
                currency=actor.active_organization.currency,
                status="received",
                invoice_date=payload.invoice_date,
                external_document_url=payload.external_document_url,
                created_at=now,
                updated_at=now,
            )
            .returning(vendor_invoices.c.id)
        )
        invoice_id = str(invoice.scalar_one())
        await record_budget_actual(
            session,
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            budget_line_id=str(budget_line.id),
            source_type="vendor_invoice",
            vendor_invoice_id=invoice_id,
            amount=payload.amount,
            currency=actor.active_organization.currency,
            source_reference=payload.invoice_number.strip(),
            allocation_date=payload.invoice_date,
        )
        allocation = await session.execute(
            insert(purchase_order_allocations)
            .values(
                organization_id=actor.organization_id,
                purchase_order_id=purchase_order_id,
                allocation_type="vendor_invoice",
                vendor_invoice_id=invoice_id,
                amount=payload.amount,
                allocation_date=payload.invoice_date,
                reference=payload.invoice_number.strip(),
                description=payload.description.strip(),
                created_by_user_id=actor.user_id,
                created_at=now,
                updated_at=now,
            )
            .returning(purchase_order_allocations.c.id)
        )
        allocation_id = str(allocation.scalar_one())
        await _audit(
            session,
            actor,
            "purchase_order.invoice_recorded",
            purchase_order_id,
            {"invoiceId": invoice_id, "budgetLineId": str(budget_line.id), "allocationId": allocation_id},
        )
        if overrun > 0:
            await _audit(
                session,
                actor,
                "purchase_order.actual_overrun_authorised",
                purchase_order_id,
                {"invoiceId": invoice_id, "overrunAmount": _currency(overrun), "reason": payload.overrun_reason},
            )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A supplier invoice with that reference already exists for this vendor.",
        ) from error
    return {
        "invoice_id": invoice_id,
        "budget_line_id": str(budget_line.id),
        "allocation_id": allocation_id,
        "purchase_order": await _detail(session, actor, purchase_order_id),
    }
