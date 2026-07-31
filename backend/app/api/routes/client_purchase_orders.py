"""Tenant-scoped client Purchase Orders: billing authority, never vendor spend."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, case, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    ClientPurchaseOrderAllocationRequest,
    ClientPurchaseOrderCreateRequest,
    ClientPurchaseOrderUpdateRequest,
)
from app.auth import require_permission
from app.budget_logic import decimal_amount, json_safe, monetary
from app.client_purchase_order_logic import client_po_balances, valid_client_po_status_transition
from app.db.tables import (
    activity_log,
    billables,
    client_invoice_items,
    client_invoices,
    client_purchase_order_allocations,
    client_purchase_orders,
    crm_companies,
    episodes,
    post_work_orders,
    seasons,
    shows,
    users,
)

router = APIRouter(prefix="/client-purchase-orders", tags=["client-purchase-orders"])


async def _audit(
    session: DbSession, actor: CurrentActor, action: str, client_purchase_order_id: str, metadata: dict[str, object]
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type="client_purchase_order",
            entity_id=client_purchase_order_id,
            metadata=json_safe(metadata),
        )
    )


async def _order_or_404(
    session: DbSession, actor: CurrentActor, client_purchase_order_id: str, *, lock: bool = False
) -> object:
    statement = select(client_purchase_orders).where(
        and_(
            client_purchase_orders.c.id == client_purchase_order_id,
            client_purchase_orders.c.organization_id == actor.organization_id,
        )
    )
    if lock:
        statement = statement.with_for_update()
    order = (await session.execute(statement.limit(1))).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client purchase order not found.")
    return order


async def _scope(
    session: DbSession,
    actor: CurrentActor,
    *,
    client_company_id: str,
    show_id: str | None,
    episode_id: str | None,
) -> tuple[str | None, str | None]:
    """Validate that the authorisation applies to one client and its scope."""
    client = (
        await session.execute(
            select(crm_companies.c.id, crm_companies.c.type).where(
                and_(
                    crm_companies.c.id == client_company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client account not found.")
    if client.type == "vendor":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A vendor account cannot be used for a client purchase order.",
        )

    show = None
    if show_id:
        show = (
            await session.execute(
                select(shows.c.id, shows.c.client_company_id).where(
                    and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id)
                )
            )
        ).first()
        if not show:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")

    episode = None
    if episode_id:
        episode = (
            await session.execute(
                select(episodes.c.id, shows.c.id.label("show_id"), shows.c.client_company_id)
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

    if show and episode and str(show.id) != str(episode.show_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The selected episode does not belong to the selected show.",
        )
    scoped_show = show or episode
    if scoped_show and str(scoped_show.client_company_id or "") != client_company_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The selected show belongs to a different client account.",
        )
    return str(show.id) if show else (str(episode.show_id) if episode else None), str(episode.id) if episode else None


async def _totals(session: DbSession, actor: CurrentActor, client_purchase_order_id: str) -> tuple[Decimal, Decimal]:
    """Client commitments and invoices are ledger rows, never editable totals."""
    row = (
        await session.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                client_purchase_order_allocations.c.allocation_type.in_(
                                    ("billable", "change_order", "work_order")
                                ),
                                client_purchase_order_allocations.c.amount,
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
                                client_purchase_order_allocations.c.allocation_type == "client_invoice",
                                client_purchase_order_allocations.c.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("invoiced"),
            ).where(
                and_(
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                    client_purchase_order_allocations.c.client_purchase_order_id == client_purchase_order_id,
                )
            )
        )
    ).one()
    return decimal_amount(row.committed), decimal_amount(row.invoiced)


async def _detail(session: DbSession, actor: CurrentActor, client_purchase_order_id: str) -> dict[str, object]:
    order = await _order_or_404(session, actor, client_purchase_order_id)
    committed, invoiced = await _totals(session, actor, client_purchase_order_id)
    balances = client_po_balances(decimal_amount(order.approved_amount), committed, invoiced)
    client_name = (
        await session.execute(
            select(crm_companies.c.name).where(
                and_(
                    crm_companies.c.id == order.client_company_id,
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
            select(client_purchase_order_allocations)
            .where(
                and_(
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                    client_purchase_order_allocations.c.client_purchase_order_id == client_purchase_order_id,
                )
            )
            .order_by(
                client_purchase_order_allocations.c.allocation_date.desc(),
                client_purchase_order_allocations.c.created_at.desc(),
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
                    activity_log.c.entity_type == "client_purchase_order",
                    activity_log.c.entity_id == client_purchase_order_id,
                )
            )
            .order_by(activity_log.c.created_at.desc())
            .limit(30)
        )
    ).all()
    return {
        "id": str(order.id),
        "client_company_id": str(order.client_company_id),
        "client_name": client_name,
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
        **{name: monetary(amount) for name, amount in balances.items()},
        "allocations": [
            {
                "id": str(item.id),
                "allocation_type": item.allocation_type,
                "billable_id": str(item.billable_id) if item.billable_id else None,
                "client_invoice_id": str(item.client_invoice_id) if item.client_invoice_id else None,
                "client_invoice_item_id": str(item.client_invoice_item_id) if item.client_invoice_item_id else None,
                "work_order_id": str(item.work_order_id) if item.work_order_id else None,
                "change_order_reference": item.change_order_reference,
                "amount": monetary(decimal_amount(item.amount)),
                "overrun_authorised": item.overrun_authorised,
                "allocation_date": item.allocation_date,
                "reference": item.reference,
                "description": item.description,
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
async def list_client_purchase_orders(
    actor: CurrentActor,
    session: DbSession,
    episode_id: str | None = Query(default=None, alias="episodeId"),
) -> dict[str, object]:
    """List the register or only Client POs applicable to one episode."""
    await require_permission(session, actor, "manage_commercial")
    if episode_id:
        episode = (
            await session.execute(
                select(episodes.c.id, seasons.c.show_id, shows.c.client_company_id)
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
        if not episode.client_company_id:
            return {"client_purchase_orders": []}
        order_ids = (
            (
                await session.execute(
                    select(client_purchase_orders.c.id)
                    .where(
                        and_(
                            client_purchase_orders.c.organization_id == actor.organization_id,
                            client_purchase_orders.c.status == "active",
                            client_purchase_orders.c.client_company_id == episode.client_company_id,
                            or_(
                                client_purchase_orders.c.show_id.is_(None),
                                client_purchase_orders.c.show_id == episode.show_id,
                            ),
                            or_(
                                client_purchase_orders.c.episode_id.is_(None),
                                client_purchase_orders.c.episode_id == episode_id,
                            ),
                            or_(
                                client_purchase_orders.c.expiry_date.is_(None),
                                client_purchase_orders.c.expiry_date >= date.today(),
                            ),
                        )
                    )
                    .order_by(client_purchase_orders.c.expiry_date, client_purchase_orders.c.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return {"client_purchase_orders": [await _detail(session, actor, str(order_id)) for order_id in order_ids]}
    order_ids = (
        (
            await session.execute(
                select(client_purchase_orders.c.id)
                .where(client_purchase_orders.c.organization_id == actor.organization_id)
                .order_by(client_purchase_orders.c.created_at.desc(), client_purchase_orders.c.id)
            )
        )
        .scalars()
        .all()
    )
    return {"client_purchase_orders": [await _detail(session, actor, str(order_id)) for order_id in order_ids]}


@router.get("/{client_purchase_order_id}")
async def get_client_purchase_order(
    client_purchase_order_id: str, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    return await _detail(session, actor, client_purchase_order_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_client_purchase_order(
    payload: ClientPurchaseOrderCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    if payload.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A client PO must be created as a draft before it can be activated.",
        )
    show_id, episode_id = await _scope(
        session,
        actor,
        client_company_id=payload.client_company_id,
        show_id=payload.show_id,
        episode_id=payload.episode_id,
    )
    now = datetime.now(UTC)
    try:
        created = await session.execute(
            insert(client_purchase_orders)
            .values(
                organization_id=actor.organization_id,
                client_company_id=payload.client_company_id,
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
            .returning(client_purchase_orders.c.id)
        )
        client_purchase_order_id = str(created.scalar_one())
        await _audit(
            session,
            actor,
            "client_purchase_order.created",
            client_purchase_order_id,
            {"poNumber": payload.po_number.strip()},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A client PO with that number already exists in this post house.",
        ) from error
    return await _detail(session, actor, client_purchase_order_id)


async def _validate_allocation_source(
    session: DbSession,
    actor: CurrentActor,
    order: object,
    payload: ClientPurchaseOrderAllocationRequest,
) -> tuple[str | None, str | None]:
    """Resolve a ledger source from tenant-owned records before allocating it."""
    if payload.allocation_type == "change_order":
        return None, None
    if payload.allocation_type == "billable":
        source = (
            await session.execute(
                select(
                    billables.c.id,
                    billables.c.show_id,
                    billables.c.episode_id,
                    billables.c.status,
                    shows.c.client_company_id,
                )
                .outerjoin(
                    shows, and_(shows.c.id == billables.c.show_id, shows.c.organization_id == actor.organization_id)
                )
                .where(
                    and_(billables.c.id == payload.billable_id, billables.c.organization_id == actor.organization_id)
                )
                .limit(1)
            )
        ).first()
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billable not found.")
        if source.status not in {"approved", "invoiced", "paid"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Only approved billables can consume a Client PO."
            )
    elif payload.allocation_type == "work_order":
        source = (
            await session.execute(
                select(
                    post_work_orders.c.id,
                    post_work_orders.c.episode_id,
                    post_work_orders.c.billing_scope,
                    episodes.c.season_id,
                    shows.c.id.label("show_id"),
                    shows.c.client_company_id,
                )
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
                .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
                .where(
                    and_(
                        post_work_orders.c.id == payload.work_order_id,
                        post_work_orders.c.organization_id == actor.organization_id,
                    )
                )
                .limit(1)
            )
        ).first()
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found.")
        if source.billing_scope != "billable_change":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only client-billable work orders can consume a Client PO.",
            )
    else:
        invoice_id = payload.client_invoice_id
        if payload.client_invoice_item_id:
            invoice_id = (
                await session.execute(
                    select(client_invoice_items.c.client_invoice_id).where(
                        and_(
                            client_invoice_items.c.id == payload.client_invoice_item_id,
                            client_invoice_items.c.organization_id == actor.organization_id,
                        )
                    )
                )
            ).scalar_one_or_none()
        source = (
            await session.execute(
                select(
                    client_invoices.c.id,
                    client_invoices.c.show_id,
                    client_invoices.c.episode_id,
                    client_invoices.c.status,
                    client_invoices.c.client_company_id,
                )
                .where(
                    and_(client_invoices.c.id == invoice_id, client_invoices.c.organization_id == actor.organization_id)
                )
                .limit(1)
            )
        ).first()
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client invoice not found.")
        if source.status not in {"issued", "paid"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only issued or paid invoices can consume a Client PO.",
            )
    if str(source.client_company_id or "") != str(order.client_company_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The source belongs to a different client account."
        )
    if order.show_id and str(source.show_id or "") != str(order.show_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The source belongs to a different show.")
    if order.episode_id and str(source.episode_id or "") != str(order.episode_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The source belongs to a different episode.")
    return str(source.show_id) if source.show_id else None, str(source.episode_id) if source.episode_id else None


@router.post("/{client_purchase_order_id}/allocations", status_code=status.HTTP_201_CREATED)
async def create_client_purchase_order_allocation(
    client_purchase_order_id: str,
    payload: ClientPurchaseOrderAllocationRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    """Add a live, tenant-safe Client PO ledger entry.

    Work-order and billing automation normally creates these rows.  The route
    remains available for authorised finance corrections and imported
    commercial records, with exactly the same scope and overrun safeguards.
    """
    await require_permission(session, actor, "manage_commercial")
    order = await _order_or_404(session, actor, client_purchase_order_id, lock=True)
    if order.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only active Client POs can receive allocations."
        )
    await _validate_allocation_source(session, actor, order, payload)
    source_column = {
        "billable": client_purchase_order_allocations.c.billable_id,
        "client_invoice": client_purchase_order_allocations.c.client_invoice_id,
        "work_order": client_purchase_order_allocations.c.work_order_id,
    }.get(payload.allocation_type)
    source_id = payload.billable_id or payload.client_invoice_id or payload.work_order_id
    if payload.client_invoice_item_id:
        source_column = client_purchase_order_allocations.c.client_invoice_item_id
        source_id = payload.client_invoice_item_id
    duplicate_conditions = [client_purchase_order_allocations.c.organization_id == actor.organization_id]
    if source_column is not None:
        duplicate_conditions.append(source_column == source_id)
    else:
        duplicate_conditions.extend(
            [
                client_purchase_order_allocations.c.client_purchase_order_id == client_purchase_order_id,
                client_purchase_order_allocations.c.change_order_reference == payload.change_order_reference,
            ]
        )
    duplicate = (
        await session.execute(
            select(client_purchase_order_allocations.c.id).where(and_(*duplicate_conditions)).limit(1)
        )
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This source already has a Client PO allocation."
        )
    committed, invoiced = await _totals(session, actor, client_purchase_order_id)
    amount = decimal_amount(payload.amount)
    next_committed = (
        committed + amount if payload.allocation_type in {"billable", "change_order", "work_order"} else committed
    )
    next_invoiced = invoiced + amount if payload.allocation_type == "client_invoice" else invoiced
    overrun_amount = max(next_committed, next_invoiced) - decimal_amount(order.approved_amount)
    if overrun_amount > 0:
        if not payload.overrun_reason:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Explain the Client PO overrun before authorising it.",
            )
        await require_permission(session, actor, "approve_budget_overruns")
    now = datetime.now(UTC)
    created = (
        await session.execute(
            insert(client_purchase_order_allocations)
            .values(
                organization_id=actor.organization_id,
                client_purchase_order_id=client_purchase_order_id,
                allocation_type=payload.allocation_type,
                billable_id=payload.billable_id,
                client_invoice_id=payload.client_invoice_id,
                client_invoice_item_id=payload.client_invoice_item_id,
                work_order_id=payload.work_order_id,
                change_order_reference=payload.change_order_reference,
                amount=amount,
                overrun_authorised=overrun_amount > 0,
                allocation_date=payload.allocation_date,
                reference=payload.reference,
                description=payload.description,
                created_by_user_id=actor.user_id,
                created_at=now,
                updated_at=now,
            )
            .returning(client_purchase_order_allocations.c.id)
        )
    ).scalar_one()
    await _audit(
        session,
        actor,
        "client_purchase_order.overrun_authorised" if overrun_amount > 0 else "client_purchase_order.allocated",
        client_purchase_order_id,
        {
            "allocationId": str(created),
            "allocationType": payload.allocation_type,
            "amount": str(amount),
            "overrunAmount": str(max(overrun_amount, Decimal(0))),
            "overrunReason": payload.overrun_reason,
        },
    )
    await session.commit()
    return await _detail(session, actor, client_purchase_order_id)


@router.patch("/{client_purchase_order_id}")
async def update_client_purchase_order(
    client_purchase_order_id: str,
    payload: ClientPurchaseOrderUpdateRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    order = await _order_or_404(session, actor, client_purchase_order_id, lock=True)
    fields = payload.model_fields_set
    requested_status = payload.status if "status" in fields else None
    status_change = requested_status is not None and requested_status != order.status
    editable_fields = fields - {"status"}
    if status_change and not valid_client_po_status_transition(order.status, requested_status):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That client PO status transition is not allowed."
        )
    if editable_fields and order.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft client POs can be edited.")
    if not status_change and not editable_fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide a client PO change.")

    final_client_company_id = (
        payload.client_company_id if "client_company_id" in fields else str(order.client_company_id)
    )
    if not final_client_company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a client account.")
    final_show_id = payload.show_id if "show_id" in fields else (str(order.show_id) if order.show_id else None)
    final_episode_id = (
        payload.episode_id if "episode_id" in fields else (str(order.episode_id) if order.episode_id else None)
    )
    final_issue_date = payload.issue_date if "issue_date" in fields else order.issue_date
    final_expiry_date = payload.expiry_date if "expiry_date" in fields else order.expiry_date
    if final_issue_date and final_expiry_date and final_expiry_date < final_issue_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Expiry date cannot be before the issue date."
        )
    show_id, episode_id = await _scope(
        session,
        actor,
        client_company_id=final_client_company_id,
        show_id=final_show_id,
        episode_id=final_episode_id,
    )
    values: dict[str, object] = {"updated_at": datetime.now(UTC)}
    if "client_company_id" in fields:
        values["client_company_id"] = final_client_company_id
    if {"client_company_id", "show_id", "episode_id"} & editable_fields:
        values["show_id"] = show_id
        values["episode_id"] = episode_id
    if "po_number" in fields:
        values["po_number"] = payload.po_number.strip() if payload.po_number else None
    if "approved_amount" in fields:
        values["approved_amount"] = payload.approved_amount
    if "issue_date" in fields:
        values["issue_date"] = payload.issue_date
    if "expiry_date" in fields:
        values["expiry_date"] = payload.expiry_date
    if "notes" in fields:
        values["notes"] = payload.notes.strip() if payload.notes else None
    if "external_document_url" in fields:
        values["external_document_url"] = payload.external_document_url
    if status_change:
        values["status"] = requested_status
    try:
        await session.execute(
            update(client_purchase_orders)
            .where(
                and_(
                    client_purchase_orders.c.id == client_purchase_order_id,
                    client_purchase_orders.c.organization_id == actor.organization_id,
                )
            )
            .values(**values)
        )
        action = (
            f"client_purchase_order.{'activated' if requested_status == 'active' else requested_status}"
            if status_change
            else "client_purchase_order.updated"
        )
        await _audit(
            session,
            actor,
            action,
            client_purchase_order_id,
            {"poNumber": values.get("po_number", order.po_number), "fields": sorted(fields)},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A client PO with that number already exists in this post house.",
        ) from error
    return await _detail(session, actor, client_purchase_order_id)
