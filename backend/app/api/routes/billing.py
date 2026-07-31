"""Tenant-scoped client billables, invoice readiness, and export safeguards.

This module owns the receivables boundary only.  It deliberately does not
implement payments, debtor management, or an accounting-system sync.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import BillableFromWorkOrderRequest, BillableVoidRequest, ClientInvoiceIssueRequest
from app.auth import require_permission
from app.billing_logic import invoice_number_prefix, invoice_totals
from app.budget_logic import decimal_amount, json_safe, monetary
from app.db.tables import (
    activity_log,
    billables,
    bookings,
    client_invoice_items,
    client_invoices,
    client_purchase_order_allocations,
    client_purchase_orders,
    crm_companies,
    episodes,
    invoice_settings,
    people,
    post_work_orders,
    seasons,
    shows,
)

router = APIRouter(prefix="/billing", tags=["billing"])


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


async def _episode_scope(session: DbSession, actor: CurrentActor, episode_id: str) -> object:
    record = (
        await session.execute(
            select(
                episodes.c.id,
                episodes.c.title,
                episodes.c.number,
                episodes.c.production_code,
                episodes.c.workflow_status,
                episodes.c.workflow_stage_id,
                shows.c.id.label("show_id"),
                shows.c.title.label("show_title"),
                shows.c.client_company_id,
                crm_companies.c.name.label("client_name"),
                crm_companies.c.address.label("client_address"),
                crm_companies.c.finance_email.label("client_email"),
                crm_companies.c.payment_terms_days,
            )
            .select_from(episodes)
            .join(
                seasons,
                and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
            )
            .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
            .outerjoin(
                crm_companies,
                and_(
                    crm_companies.c.id == shows.c.client_company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                ),
            )
            .where(and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    return record


def _episode_value(episode: object) -> dict[str, object]:
    return {
        "id": str(episode.id),
        "title": episode.title,
        "number": episode.number,
        "production_code": episode.production_code,
        "show_id": str(episode.show_id),
        "show_title": episode.show_title,
        "client_company_id": str(episode.client_company_id) if episode.client_company_id else None,
        "client_name": episode.client_name,
        "workflow_complete": episode.workflow_status == "complete",
    }


async def _client_po_warnings(
    session: DbSession,
    actor: CurrentActor,
    *,
    sources: list[dict[str, object]],
    require_active: bool,
    as_of: date | None = None,
) -> list[dict[str, object]]:
    """Return billing blockers from the live Client-PO ledger.

    A selected Client PO is compulsory for that individual source, but Client
    POs remain optional for charges that were deliberately created without one.
    """
    selected_po_ids = [source["client_purchase_order_id"] for source in sources]
    po_ids = sorted({str(purchase_order_id) for purchase_order_id in selected_po_ids if purchase_order_id})
    if not po_ids:
        return []
    orders = (
        await session.execute(
            select(client_purchase_orders).where(
                and_(
                    client_purchase_orders.c.organization_id == actor.organization_id,
                    client_purchase_orders.c.id.in_(po_ids),
                )
            )
        )
    ).all()
    allocations = (
        await session.execute(
            select(client_purchase_order_allocations).where(
                and_(
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                    client_purchase_order_allocations.c.client_purchase_order_id.in_(po_ids),
                )
            )
        )
    ).all()
    orders_by_id = {str(order.id): order for order in orders}
    allocations_by_order: dict[str, list[object]] = defaultdict(list)
    for allocation in allocations:
        allocations_by_order[str(allocation.client_purchase_order_id)].append(allocation)

    today = as_of or datetime.now(UTC).date()
    warnings: list[dict[str, object]] = []
    for purchase_order_id in po_ids:
        order = orders_by_id.get(purchase_order_id)
        order_sources = []
        for source in sources:
            if str(source.get("client_purchase_order_id")) == purchase_order_id:
                order_sources.append(source)
        if not order:
            warnings.append(
                {
                    "client_purchase_order_id": purchase_order_id,
                    "po_number": "Missing client PO",
                    "kind": "missing_allocation",
                    "message": "A required Client PO is no longer available in this post house.",
                    "blocks_billing": True,
                }
            )
            continue

        order_allocations = allocations_by_order[purchase_order_id]
        for source in order_sources:
            source_id = str(source["id"])
            source_kind = str(source["kind"])
            covered = any(
                allocation.allocation_type == source_kind
                and str(
                    allocation.billable_id
                    if source_kind == "billable"
                    else allocation.client_invoice_item_id
                    if source_kind == "client_invoice"
                    else ""
                )
                == source_id
                for allocation in order_allocations
            )
            if not covered:
                label = "billable commitment" if source_kind == "billable" else "invoice allocation"
                warnings.append(
                    {
                        "client_purchase_order_id": purchase_order_id,
                        "po_number": order.po_number,
                        "kind": "missing_allocation",
                        "message": f"{order.po_number} is required for this charge, but its {label} is missing.",
                        "blocks_billing": True,
                    }
                )
                break

        if require_active and order.status != "active":
            warnings.append(
                {
                    "client_purchase_order_id": purchase_order_id,
                    "po_number": order.po_number,
                    "kind": "inactive",
                    "message": f"{order.po_number} is {order.status} and cannot authorise a new invoice.",
                    "blocks_billing": True,
                }
            )
        if order.expiry_date and order.expiry_date < today:
            warnings.append(
                {
                    "client_purchase_order_id": purchase_order_id,
                    "po_number": order.po_number,
                    "kind": "expired",
                    "message": f"{order.po_number} expired on {order.expiry_date.isoformat()}.",
                    "blocks_billing": True,
                }
            )
        elif order.expiry_date and order.status == "active" and order.expiry_date <= today + timedelta(days=30):
            days = (order.expiry_date - today).days
            warnings.append(
                {
                    "client_purchase_order_id": purchase_order_id,
                    "po_number": order.po_number,
                    "kind": "expiring",
                    "message": f"{order.po_number} expires in {days} day{'s' if days != 1 else ''}.",
                    "blocks_billing": False,
                }
            )

        committed = sum(
            (
                decimal_amount(allocation.amount)
                for allocation in order_allocations
                if allocation.allocation_type in {"billable", "change_order", "work_order"}
            ),
            Decimal(0),
        )
        invoiced = sum(
            (
                decimal_amount(allocation.amount)
                for allocation in order_allocations
                if allocation.allocation_type == "client_invoice"
            ),
            Decimal(0),
        )
        authorised = decimal_amount(order.approved_amount)
        # Fully consuming a Client PO is expected. It must not prevent issuing
        # an already committed item; only a true excess is a billing blocker.
        if committed == authorised:
            warnings.append(
                {
                    "client_purchase_order_id": purchase_order_id,
                    "po_number": order.po_number,
                    "kind": "exhausted",
                    "message": f"{order.po_number} has no uncommitted billing authority remaining.",
                    "blocks_billing": False,
                }
            )
        if max(committed, invoiced) > authorised and not any(
            allocation.overrun_authorised for allocation in order_allocations
        ):
            warnings.append(
                {
                    "client_purchase_order_id": purchase_order_id,
                    "po_number": order.po_number,
                    "kind": "overrun_unapproved",
                    "message": f"{order.po_number} exceeds its authorised value without recorded overrun approval.",
                    "blocks_billing": True,
                }
            )
    return warnings


async def _episode_invoice_readiness(
    session: DbSession,
    actor: CurrentActor,
    episode_id: str,
    *,
    include_invoice_export_reasons: bool = True,
) -> dict[str, object]:
    episode = await _episode_scope(session, actor, episode_id)
    unconfirmed_bookings = (
        await session.execute(
            select(bookings.c.id, bookings.c.title, people.c.name.label("person_name"))
            .select_from(bookings)
            .outerjoin(
                people,
                and_(people.c.id == bookings.c.person_id, people.c.organization_id == actor.organization_id),
            )
            .where(
                and_(
                    bookings.c.organization_id == actor.organization_id,
                    bookings.c.episode_id == episode_id,
                    bookings.c.person_id.is_not(None),
                    bookings.c.status != "cancelled",
                    or_(bookings.c.actual_starts_at.is_(None), bookings.c.actual_ends_at.is_(None)),
                )
            )
            .order_by(bookings.c.starts_at, bookings.c.id)
        )
    ).all()
    ready_billables = (
        await session.execute(
            select(billables)
            .where(
                and_(
                    billables.c.organization_id == actor.organization_id,
                    billables.c.episode_id == episode_id,
                    billables.c.status == "approved",
                    billables.c.client_invoice_id.is_(None),
                )
            )
            .order_by(billables.c.created_at, billables.c.id)
        )
    ).all()
    issued_invoices = (
        await session.execute(
            select(client_invoices)
            .where(
                and_(
                    client_invoices.c.organization_id == actor.organization_id,
                    client_invoices.c.episode_id == episode_id,
                )
            )
            .order_by(client_invoices.c.sequence, client_invoices.c.id)
        )
    ).all()
    profile = (
        await session.execute(
            select(invoice_settings).where(invoice_settings.c.organization_id == actor.organization_id).limit(1)
        )
    ).first()
    warnings = await _client_po_warnings(
        session,
        actor,
        sources=[
            {
                "id": str(item.id),
                "kind": "billable",
                "client_purchase_order_id": str(item.client_purchase_order_id)
                if item.client_purchase_order_id
                else None,
            }
            for item in ready_billables
        ],
        require_active=True,
    )
    client_missing = not episode.client_company_id or not episode.client_name
    profile_complete = bool(profile and (profile.legal_name or "").strip() and (profile.legal_address or "").strip())
    workflow_complete = episode.workflow_status == "complete"
    client_po_blocker = next((warning for warning in warnings if warning["blocks_billing"]), None)
    ready_to_issue = bool(
        profile_complete
        and not client_missing
        and workflow_complete
        and not unconfirmed_bookings
        and ready_billables
        and not client_po_blocker
    )
    blocked_reason = (
        "Assign a client or production company to the show before issuing an invoice."
        if client_missing
        else "Complete the episode workflow before issuing an invoice."
        if not workflow_complete
        else (
            "Complete the invoicing profile with the legal entity name and registered address "
            "before issuing an invoice."
        )
        if not profile_complete
        else (
            f"{len(unconfirmed_bookings)} assigned booking"
            f"{'s' if len(unconfirmed_bookings) != 1 else ''} still need actual time confirmed."
        )
        if unconfirmed_bookings
        else "No approved client charges are ready to invoice."
        if not ready_billables
        else str(client_po_blocker["message"])
        if client_po_blocker
        else None
    )
    total = sum((decimal_amount(item.amount) for item in ready_billables), Decimal(0))
    invoice_values = []
    for item in issued_invoices:
        value: dict[str, object] = {
            "id": str(item.id),
            "invoice_number": item.invoice_number,
            "status": item.status,
            "invoice_date": item.invoice_date,
            "due_date": item.due_date,
            "total_amount": monetary(decimal_amount(item.total_amount)),
            "currency": item.currency,
        }
        if include_invoice_export_reasons:
            # The register must show a real export lock, not merely hide the
            # download control. Reuse the authoritative reconciliation gate.
            value["export_blocked_reason"] = (
                await _invoice_export_readiness(session, actor, str(item.id))
            )["blocked_reason"]
        invoice_values.append(value)

    return {
        "episode": _episode_value(episode),
        "unconfirmed_bookings": [
            {"id": str(item.id), "title": item.title, "person_name": item.person_name} for item in unconfirmed_bookings
        ],
        "billables": [
            {
                "id": str(item.id),
                "description": item.description,
                "reference": item.reference,
                "amount": monetary(decimal_amount(item.amount)),
                "currency": item.currency,
                "client_purchase_order_id": str(item.client_purchase_order_id)
                if item.client_purchase_order_id
                else None,
            }
            for item in ready_billables
        ],
        "invoices": invoice_values,
        "invoice_profile_complete": profile_complete,
        "workflow_complete": workflow_complete,
        "invoice_ready_total": monetary(total),
        "client_po_warnings": warnings,
        "ready_to_issue": ready_to_issue,
        "blocked_reason": blocked_reason,
    }


def _billable_value(row: object) -> dict[str, object]:
    return {
        "id": str(row.id),
        "episode_id": str(row.episode_id) if row.episode_id else None,
        "show_id": str(row.show_id) if row.show_id else None,
        "client_invoice_id": str(row.client_invoice_id) if row.client_invoice_id else None,
        "client_purchase_order_id": str(row.client_purchase_order_id) if row.client_purchase_order_id else None,
        "reference": row.reference,
        "description": row.description,
        "amount": monetary(decimal_amount(row.amount)),
        "currency": row.currency,
        "status": row.status,
        "created_at": row.created_at,
    }


@router.get("/episodes/{episode_id}/readiness")
async def episode_invoice_readiness(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    return await _episode_invoice_readiness(session, actor, episode_id)


@router.get("/work-order-charges")
async def list_work_order_charges(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Commercial work awaiting conversion into a server-valued billable.

    The work order already owns both approved quote and optional Client PO, so
    this view deliberately exposes no client-editable pricing authority.
    """
    await require_permission(session, actor, "manage_commercial")
    rows = (
        await session.execute(
            select(
                post_work_orders.c.id,
                post_work_orders.c.title,
                post_work_orders.c.department,
                post_work_orders.c.status,
                post_work_orders.c.billing_status,
                post_work_orders.c.estimated_amount,
                post_work_orders.c.client_quote_amount,
                post_work_orders.c.currency,
                post_work_orders.c.client_quote_currency,
                post_work_orders.c.billing_notes,
                post_work_orders.c.episode_id,
                post_work_orders.c.client_purchase_order_id,
                episodes.c.title.label("episode_title"),
                episodes.c.number.label("episode_number"),
                shows.c.id.label("show_id"),
                shows.c.title.label("show_title"),
                shows.c.client_company_id,
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
            .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
            .where(
                and_(
                    post_work_orders.c.organization_id == actor.organization_id,
                    post_work_orders.c.work_type == "internal",
                    post_work_orders.c.billing_scope == "billable_change",
                )
            )
            .order_by(post_work_orders.c.created_at, post_work_orders.c.id)
        )
    ).all()
    return {
        "work_order_charges": [
            {
                "id": str(row.id),
                "title": row.title,
                "department": row.department,
                "status": row.status,
                "billing_status": row.billing_status,
                "estimated_amount": monetary(decimal_amount(row.client_quote_amount or row.estimated_amount)),
                "currency": row.client_quote_currency or row.currency or actor.active_organization.currency,
                "billing_notes": row.billing_notes,
                "episode_id": str(row.episode_id),
                "episode_title": row.episode_title,
                "episode_number": row.episode_number,
                "show_id": str(row.show_id),
                "show_title": row.show_title,
                "client_company_id": str(row.client_company_id) if row.client_company_id else None,
                "client_purchase_order_id": (
                    str(row.client_purchase_order_id) if row.client_purchase_order_id else None
                ),
            }
            for row in rows
        ]
    }


@router.post("/work-orders/{work_order_id}/billables", status_code=status.HTTP_201_CREATED)
async def create_billable_from_work_order(
    work_order_id: str,
    payload: BillableFromWorkOrderRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    """Post one completed, independently approved client change as a billable."""
    await require_permission(session, actor, "manage_commercial")
    work_order = (
        await session.execute(
            select(post_work_orders)
            .where(
                and_(
                    post_work_orders.c.id == work_order_id,
                    post_work_orders.c.organization_id == actor.organization_id,
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not work_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found.")
    if work_order.work_type != "internal" or work_order.billing_scope != "billable_change":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only internal client-billable work can be posted."
        )
    if work_order.status != "complete" or not work_order.approved_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete an approved client change before posting it as a billable.",
        )
    if work_order.billing_status == "posted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This work order has already been posted to billing."
        )
    amount = decimal_amount(work_order.client_quote_amount)
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This work order has no approved client quote."
        )
    episode = await _episode_scope(session, actor, str(work_order.episode_id))
    if not episode.client_company_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Assign a client to the show before posting billing."
        )

    po_allocation = None
    if work_order.client_purchase_order_id:
        client_purchase_order = (
            await session.execute(
                select(client_purchase_orders)
                .where(
                    and_(
                        client_purchase_orders.c.id == work_order.client_purchase_order_id,
                        client_purchase_orders.c.organization_id == actor.organization_id,
                    )
                )
                .with_for_update()
                .limit(1)
            )
        ).first()
        if (
            not client_purchase_order
            or client_purchase_order.status != "active"
            or (client_purchase_order.expiry_date and client_purchase_order.expiry_date < datetime.now(UTC).date())
            or str(client_purchase_order.client_company_id) != str(episode.client_company_id)
            or (client_purchase_order.show_id and str(client_purchase_order.show_id) != str(episode.show_id))
            or (client_purchase_order.episode_id and str(client_purchase_order.episode_id) != str(episode.id))
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The attached Client PO is no longer active or does not apply to this work.",
            )
        po_allocation = (
            await session.execute(
                select(client_purchase_order_allocations)
                .where(
                    and_(
                        client_purchase_order_allocations.c.organization_id == actor.organization_id,
                        client_purchase_order_allocations.c.work_order_id == work_order_id,
                        client_purchase_order_allocations.c.allocation_type == "work_order",
                    )
                )
                .with_for_update()
                .limit(1)
            )
        ).first()
        if not po_allocation:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The selected Client PO has no approved work-order commitment.",
            )

    now = datetime.now(UTC)
    reference = payload.reference.strip() if payload.reference else f"WO-{str(work_order.id)[:8].upper()}"
    created = await session.execute(
        insert(billables)
        .values(
            organization_id=actor.organization_id,
            show_id=episode.show_id,
            episode_id=episode.id,
            client_purchase_order_id=work_order.client_purchase_order_id,
            vendor=episode.client_name or "Client",
            reference=reference,
            description=work_order.title,
            amount=amount,
            currency=actor.active_organization.currency,
            status="approved",
            rate_source="approved_client_change",
            rate_snapshot={"workOrderId": work_order_id, "clientQuoteAmount": str(amount)},
            source_work_order_id=work_order.id,
            created_at=now,
            updated_at=now,
        )
        .returning(billables)
    )
    billable = created.one()
    if po_allocation:
        # Replace the approved work-order reservation with its precise
        # billable source in-place. The amount remains committed exactly once.
        await session.execute(
            update(client_purchase_order_allocations)
            .where(
                and_(
                    client_purchase_order_allocations.c.id == po_allocation.id,
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                )
            )
            .values(
                allocation_type="billable",
                work_order_id=None,
                billable_id=billable.id,
                reference=reference,
                description=work_order.title,
                updated_at=now,
            )
        )
    await session.execute(
        update(post_work_orders)
        .where(
            and_(post_work_orders.c.id == work_order_id, post_work_orders.c.organization_id == actor.organization_id)
        )
        .values(actual_amount=amount, billing_status="posted", updated_at=now)
    )
    await _audit(
        session,
        actor,
        action="billable.posted_from_work_order",
        entity_type="billable",
        entity_id=str(billable.id),
        metadata={"workOrderId": work_order_id, "episodeId": str(episode.id), "amount": str(amount)},
    )
    if work_order.client_purchase_order_id:
        await _audit(
            session,
            actor,
            action="client_purchase_order.work_order_posted_to_billable",
            entity_type="client_purchase_order",
            entity_id=str(work_order.client_purchase_order_id),
            metadata={"workOrderId": work_order_id, "billableId": str(billable.id), "amount": str(amount)},
        )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This work order was already posted to billing."
        ) from error
    return _billable_value(billable)


@router.post("/billables/{billable_id}/void")
async def void_billable(
    billable_id: str, payload: BillableVoidRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Void a pre-invoice client charge and release its PO commitment once.

    Issued invoices deliberately cannot be changed through this route: they
    require a future credit-note flow. Before issue, the billable is still an
    operational source record and can be released with a complete audit trail.
    """
    await require_permission(session, actor, "manage_commercial")
    billable = (
        await session.execute(
            select(billables)
            .where(and_(billables.c.id == billable_id, billables.c.organization_id == actor.organization_id))
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not billable:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billable not found.")
    if billable.status == "void":
        return {**_billable_value(billable), "released": False}
    if billable.status != "approved" or billable.client_invoice_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an approved, uninvoiced billable can be voided. Issue a credit note for an invoiced charge.",
        )
    now = datetime.now(UTC)
    released = await session.execute(
        delete(client_purchase_order_allocations).where(
            and_(
                client_purchase_order_allocations.c.organization_id == actor.organization_id,
                client_purchase_order_allocations.c.billable_id == billable_id,
                client_purchase_order_allocations.c.allocation_type == "billable",
            )
        )
    )
    changed = await session.execute(
        update(billables)
        .where(and_(billables.c.id == billable_id, billables.c.organization_id == actor.organization_id))
        .values(status="void", override_reason=payload.reason.strip(), updated_at=now)
        .returning(billables)
    )
    row = changed.one()
    work_order_id = str(row.source_work_order_id) if row.source_work_order_id else None
    if not work_order_id and isinstance(row.rate_snapshot, dict):
        candidate = row.rate_snapshot.get("workOrderId")
        work_order_id = str(candidate) if candidate else None
    if work_order_id:
        await session.execute(
            update(post_work_orders)
            .where(
                and_(
                    post_work_orders.c.id == work_order_id,
                    post_work_orders.c.organization_id == actor.organization_id,
                    post_work_orders.c.billing_status == "posted",
                )
            )
            .values(billing_status="draft", updated_at=now)
        )
    await _audit(
        session,
        actor,
        action="billable.voided",
        entity_type="billable",
        entity_id=billable_id,
        metadata={"reason": payload.reason.strip(), "releasedClientPoAllocation": bool(released.rowcount)},
    )
    await session.commit()
    return {**_billable_value(row), "released": bool(released.rowcount)}


async def _invoice_po_scope(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode: object,
    client_purchase_order_id: str,
    invoice_item: object,
    overrun_reasons: dict[str, str],
    invoice_date: date,
) -> bool:
    """Validate and record a client-PO invoice allocation for one line."""
    await session.execute(
        select(func.pg_advisory_xact_lock(func.hashtext(f"postpilot-client-po:{client_purchase_order_id}")))
    )
    order = (
        await session.execute(
            select(client_purchase_orders)
            .where(
                and_(
                    client_purchase_orders.c.id == client_purchase_order_id,
                    client_purchase_orders.c.organization_id == actor.organization_id,
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not order or order.status != "active" or (order.expiry_date and order.expiry_date < invoice_date):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An attached Client PO is no longer active.")
    if (
        str(order.client_company_id) != str(episode.client_company_id)
        or (order.show_id and str(order.show_id) != str(episode.show_id))
        or (order.episode_id and str(order.episode_id) != str(episode.id))
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="An attached Client PO does not apply to this invoice."
        )
    invoiced = await session.scalar(
        select(func.coalesce(func.sum(client_purchase_order_allocations.c.amount), 0)).where(
            and_(
                client_purchase_order_allocations.c.organization_id == actor.organization_id,
                client_purchase_order_allocations.c.client_purchase_order_id == client_purchase_order_id,
                client_purchase_order_allocations.c.allocation_type == "client_invoice",
            )
        )
    )
    projected = decimal_amount(invoiced) + decimal_amount(invoice_item.amount)
    overrun = projected - decimal_amount(order.approved_amount)
    overrun_authorised = overrun > 0
    if overrun_authorised:
        reason = overrun_reasons.get(client_purchase_order_id)
        if not reason:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Client PO {order.po_number} would be exceeded by {monetary(overrun):.2f}. "
                    "Supply an overrun reason."
                ),
            )
        await require_permission(session, actor, "manage_commercial")
    await session.execute(
        insert(client_purchase_order_allocations).values(
            organization_id=actor.organization_id,
            client_purchase_order_id=client_purchase_order_id,
            allocation_type="client_invoice",
            client_invoice_item_id=invoice_item.id,
            amount=invoice_item.amount,
            overrun_authorised=overrun_authorised,
            allocation_date=invoice_date,
            reference=invoice_item.reference,
            description=invoice_item.description,
            created_by_user_id=actor.user_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    return overrun_authorised


@router.post("/invoices", status_code=status.HTTP_201_CREATED)
async def issue_client_invoice(
    payload: ClientInvoiceIssueRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Issue an immutable invoice from every approved, uninvoiced episode charge."""
    await require_permission(session, actor, "manage_commercial")
    readiness = await _episode_invoice_readiness(session, actor, payload.episode_id)
    episode_data = readiness["episode"]
    if not readiness["ready_to_issue"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(readiness["blocked_reason"] or "This invoice is not ready to issue."),
        )
    episode = await _episode_scope(session, actor, payload.episode_id)
    profile = (
        await session.execute(
            select(invoice_settings).where(invoice_settings.c.organization_id == actor.organization_id).limit(1)
        )
    ).first()
    # Readiness has already established a complete profile and client, but keep
    # this defensive guard close to the immutable document creation.
    if not profile or not (profile.legal_name or "").strip() or not (profile.legal_address or "").strip():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The invoicing profile is incomplete.")

    today = datetime.now(UTC).date()
    due_date = today + timedelta(days=profile.payment_terms_days or episode.payment_terms_days or 30)
    billable_rows = (
        await session.execute(
            select(billables)
            .where(
                and_(
                    billables.c.organization_id == actor.organization_id,
                    billables.c.episode_id == payload.episode_id,
                    billables.c.status == "approved",
                    billables.c.client_invoice_id.is_(None),
                )
            )
            .with_for_update()
            .order_by(billables.c.created_at, billables.c.id)
        )
    ).all()
    if not billable_rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No approved client charges are ready to invoice."
        )
    totals = invoice_totals(
        sum((decimal_amount(item.amount) for item in billable_rows), Decimal(0)),
        tax_enabled=profile.tax_enabled,
        tax_rate_percent=decimal_amount(profile.tax_rate_percent),
    )
    await session.execute(
        select(func.pg_advisory_xact_lock(func.hashtext(f"postpilot-client-invoices:{actor.organization_id}")))
    )
    latest_sequence = await session.scalar(
        select(func.coalesce(func.max(client_invoices.c.sequence), 0)).where(
            client_invoices.c.organization_id == actor.organization_id
        )
    )
    sequence = int(latest_sequence or 0) + 1
    invoice_number = f"{invoice_number_prefix(actor.active_organization.organization_slug)}-{today.year}-{sequence:04d}"
    now = datetime.now(UTC)
    created = await session.execute(
        insert(client_invoices)
        .values(
            organization_id=actor.organization_id,
            sequence=sequence,
            invoice_number=invoice_number,
            client_company_id=episode.client_company_id,
            show_id=episode.show_id,
            episode_id=episode.id,
            status="issued",
            invoice_date=today,
            due_date=due_date,
            currency=actor.active_organization.currency,
            subtotal_amount=totals["subtotal_amount"],
            tax_enabled=profile.tax_enabled,
            tax_name=profile.tax_name,
            tax_rate_percent=decimal_amount(profile.tax_rate_percent) if profile.tax_enabled else Decimal(0),
            tax_amount=totals["tax_amount"],
            total_amount=totals["total_amount"],
            issuer_name=profile.legal_name.strip(),
            issuer_address=profile.legal_address,
            issuer_email=profile.billing_email,
            issuer_tax_registration_number=profile.tax_registration_number,
            client_name=episode.client_name,
            client_address=episode.client_address,
            client_email=episode.client_email,
            payment_instructions=profile.payment_instructions,
            created_at=now,
            updated_at=now,
        )
        .returning(client_invoices)
    )
    invoice = created.one()
    created_items = (
        await session.execute(
            insert(client_invoice_items)
            .values(
                [
                    {
                        "organization_id": actor.organization_id,
                        "client_invoice_id": invoice.id,
                        "billable_id": item.id,
                        "client_purchase_order_id": item.client_purchase_order_id,
                        "description": item.description.strip() if item.description else "Post-production services",
                        "reference": item.reference,
                        "quantity": Decimal(1),
                        "unit_amount": item.amount,
                        "amount": item.amount,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for item in billable_rows
                ]
            )
            .returning(client_invoice_items)
        )
    ).all()
    overrun_reasons = {item.client_purchase_order_id: item.reason.strip() for item in payload.client_po_overruns}
    client_po_events: list[tuple[str, str, bool]] = []
    for item in created_items:
        if item.client_purchase_order_id:
            overrun_authorised = await _invoice_po_scope(
                session,
                actor,
                episode=episode,
                client_purchase_order_id=str(item.client_purchase_order_id),
                invoice_item=item,
                overrun_reasons=overrun_reasons,
                invoice_date=today,
            )
            client_po_events.append((str(item.client_purchase_order_id), str(item.id), overrun_authorised))
    claimed = await session.execute(
        update(billables)
        .where(
            and_(
                billables.c.organization_id == actor.organization_id,
                billables.c.id.in_([item.id for item in billable_rows]),
                billables.c.status == "approved",
                billables.c.client_invoice_id.is_(None),
            )
        )
        .values(
            client_invoice_id=invoice.id,
            status="invoiced",
            invoice_date=today,
            due_date=due_date,
            updated_at=now,
        )
        .returning(billables.c.id)
    )
    if len(claimed.all()) != len(billable_rows):
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="One or more client charges were already invoiced."
        )
    await _audit(
        session,
        actor,
        action="client_invoice.issued",
        entity_type="client_invoice",
        entity_id=str(invoice.id),
        metadata={
            "episodeId": str(episode.id),
            "invoiceNumber": invoice.invoice_number,
            "subtotal": monetary(totals["subtotal_amount"]),
            "taxAmount": monetary(totals["tax_amount"]),
            "totalAmount": monetary(totals["total_amount"]),
            "currency": actor.active_organization.currency,
        },
    )
    for purchase_order_id, invoice_item_id, overrun_authorised in client_po_events:
        await _audit(
            session,
            actor,
            action="client_purchase_order.overrun_authorised"
            if overrun_authorised
            else "client_purchase_order.invoice_entered",
            entity_type="client_purchase_order",
            entity_id=purchase_order_id,
            metadata={
                "invoiceId": str(invoice.id),
                "invoiceNumber": invoice.invoice_number,
                "invoiceItemId": invoice_item_id,
                "allocationType": "client_invoice",
            },
        )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The invoice could not be issued safely."
        ) from error
    return {
        "id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
        "status": invoice.status,
        "subtotal_amount": monetary(totals["subtotal_amount"]),
        "tax_amount": monetary(totals["tax_amount"]),
        "total_amount": monetary(totals["total_amount"]),
        "currency": invoice.currency,
        "episode": episode_data,
    }


async def _invoice_or_404(session: DbSession, actor: CurrentActor, invoice_id: str) -> object:
    invoice = (
        await session.execute(
            select(client_invoices)
            .where(and_(client_invoices.c.id == invoice_id, client_invoices.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")
    return invoice


async def _invoice_export_readiness(session: DbSession, actor: CurrentActor, invoice_id: str) -> dict[str, object]:
    invoice = await _invoice_or_404(session, actor, invoice_id)
    checks = {
        "workflowComplete": False,
        "allRequiredActualsSubmitted": False,
        "billablesReconcile": False,
        "clientPoValid": False,
        "invoiceLinesEqualSourceBillables": False,
        "totalsReconcile": False,
    }
    blocking_reasons: list[str] = []
    blocking_records: list[dict[str, object]] = []
    if invoice.status == "void":
        blocking_reasons.append("A void invoice cannot be exported.")
        blocking_records.append({"type": "invoice", "id": str(invoice.id), "label": invoice.invoice_number})
    if not invoice.episode_id:
        blocking_reasons.append("This invoice is not linked to an episode.")
        blocking_records.append({"type": "invoice", "id": str(invoice.id), "label": invoice.invoice_number})
        return {
            "invoice_id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "exportable": False,
            "blockingReasons": blocking_reasons,
            "blockingRecords": blocking_records,
            "checks": checks,
            # Compatibility with the existing UI contract.
            "blocked_reason": blocking_reasons[0],
            "client_po_warnings": [],
        }

    readiness = await _episode_invoice_readiness(
        session,
        actor,
        str(invoice.episode_id),
        include_invoice_export_reasons=False,
    )
    checks["workflowComplete"] = bool(readiness["workflow_complete"])
    if not checks["workflowComplete"]:
        blocking_reasons.append("Complete the episode workflow before exporting its invoice.")
        blocking_records.append(
            {"type": "episode", "id": str(invoice.episode_id), "label": readiness["episode"]["title"]}
        )
    checks["allRequiredActualsSubmitted"] = not bool(readiness["unconfirmed_bookings"])
    if not checks["allRequiredActualsSubmitted"]:
        blocking_reasons.append("Confirm actual time for every assigned episode booking before invoice export.")
        blocking_records.extend(
            {
                "type": "booking",
                "id": item["id"],
                "label": item["title"],
                "person": item["person_name"],
            }
            for item in readiness["unconfirmed_bookings"]
        )
    items = (
        await session.execute(
            select(client_invoice_items)
            .where(
                and_(
                    client_invoice_items.c.organization_id == actor.organization_id,
                    client_invoice_items.c.client_invoice_id == invoice_id,
                )
            )
            .order_by(client_invoice_items.c.created_at, client_invoice_items.c.id)
        )
    ).all()
    item_billable_ids = [item.billable_id for item in items if item.billable_id]
    source_billables = (
        await session.execute(
            select(billables).where(
                and_(
                    billables.c.organization_id == actor.organization_id,
                    billables.c.id.in_(item_billable_ids or ["00000000-0000-0000-0000-000000000000"]),
                )
            )
        )
    ).all()
    sources_by_id = {str(source.id): source for source in source_billables}
    source_ids = [str(item.billable_id) for item in items if item.billable_id]
    lines_have_unique_sources = len(source_ids) == len(set(source_ids)) == len(items)
    source_states_match = all(
        (source := sources_by_id.get(str(item.billable_id)))
        and source.status == "invoiced"
        and str(source.client_invoice_id) == str(invoice.id)
        for item in items
    )
    checks["billablesReconcile"] = bool(items) and lines_have_unique_sources and source_states_match
    if not checks["billablesReconcile"]:
        blocking_reasons.append("One or more invoice lines are not reconciled to an invoiced source billable.")
        blocking_records.append({"type": "invoice", "id": str(invoice.id), "label": invoice.invoice_number})

    line_values_match_sources = all(
        (source := sources_by_id.get(str(item.billable_id)))
        and decimal_amount(item.amount) == decimal_amount(source.amount)
        and decimal_amount(item.amount)
        == invoice_totals(
            decimal_amount(item.quantity) * decimal_amount(item.unit_amount),
            tax_enabled=False,
            tax_rate_percent=Decimal(0),
        )["subtotal_amount"]
        for item in items
    )
    checks["invoiceLinesEqualSourceBillables"] = checks["billablesReconcile"] and line_values_match_sources
    if not checks["invoiceLinesEqualSourceBillables"]:
        blocking_reasons.append("An invoice line does not exactly match its source billable.")

    calculated = invoice_totals(
        sum((decimal_amount(item.amount) for item in items), Decimal(0)),
        tax_enabled=bool(invoice.tax_enabled),
        tax_rate_percent=decimal_amount(invoice.tax_rate_percent),
    )
    checks["totalsReconcile"] = (
        calculated["subtotal_amount"] == decimal_amount(invoice.subtotal_amount)
        and calculated["tax_amount"] == decimal_amount(invoice.tax_amount)
        and calculated["total_amount"] == decimal_amount(invoice.total_amount)
    )
    if not checks["totalsReconcile"]:
        blocking_reasons.append("Invoice line totals and the saved invoice totals do not reconcile.")
        blocking_records.append({"type": "invoice", "id": str(invoice.id), "label": invoice.invoice_number})
    warnings = await _client_po_warnings(
        session,
        actor,
        sources=[
            {
                "id": str(item.id),
                "kind": "client_invoice",
                "client_purchase_order_id": str(item.client_purchase_order_id)
                if item.client_purchase_order_id
                else None,
            }
            for item in items
        ],
        require_active=False,
        as_of=invoice.invoice_date,
    )
    po_blockers = [warning for warning in warnings if warning["blocks_billing"]]
    checks["clientPoValid"] = not po_blockers
    for warning in po_blockers:
        blocking_reasons.append(str(warning["message"]))
        blocking_records.append(
            {
                "type": "client_purchase_order",
                "id": str(warning["client_purchase_order_id"]),
                "label": str(warning["po_number"]),
            }
        )
    exportable = bool(invoice.status != "void" and all(checks.values()))
    return {
        "invoice_id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
        "exportable": exportable,
        "blockingReasons": blocking_reasons,
        "blockingRecords": blocking_records,
        "checks": checks,
        "blocked_reason": blocking_reasons[0] if blocking_reasons else None,
        "client_po_warnings": warnings,
    }


@router.get("/invoices/{invoice_id}/export-readiness")
async def invoice_export_readiness(invoice_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    return await _invoice_export_readiness(session, actor, invoice_id)


@router.get("/invoices/{invoice_id}/export")
async def exportable_invoice(invoice_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return an export-safe immutable invoice payload; rendering is a UI concern."""
    await require_permission(session, actor, "manage_commercial")
    gate = await _invoice_export_readiness(session, actor, invoice_id)
    if not gate["exportable"]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(gate["blocked_reason"]))
    invoice = await _invoice_or_404(session, actor, invoice_id)
    items = (
        await session.execute(
            select(client_invoice_items)
            .where(
                and_(
                    client_invoice_items.c.organization_id == actor.organization_id,
                    client_invoice_items.c.client_invoice_id == invoice_id,
                )
            )
            .order_by(client_invoice_items.c.created_at, client_invoice_items.c.id)
        )
    ).all()
    return {
        "invoice": {
            "id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "status": invoice.status,
            "invoice_date": invoice.invoice_date,
            "due_date": invoice.due_date,
            "currency": invoice.currency,
            "subtotal_amount": monetary(decimal_amount(invoice.subtotal_amount)),
            "tax_enabled": invoice.tax_enabled,
            "tax_name": invoice.tax_name,
            "tax_rate_percent": monetary(decimal_amount(invoice.tax_rate_percent)),
            "tax_amount": monetary(decimal_amount(invoice.tax_amount)),
            "total_amount": monetary(decimal_amount(invoice.total_amount)),
            "issuer": {
                "name": invoice.issuer_name,
                "address": invoice.issuer_address,
                "email": invoice.issuer_email,
                "tax_registration_number": invoice.issuer_tax_registration_number,
                "payment_instructions": invoice.payment_instructions,
            },
            "client": {"name": invoice.client_name, "address": invoice.client_address, "email": invoice.client_email},
        },
        "items": [
            {
                "id": str(item.id),
                "description": item.description,
                "reference": item.reference,
                "quantity": float(item.quantity),
                "unit_amount": monetary(decimal_amount(item.unit_amount)),
                "amount": monetary(decimal_amount(item.amount)),
            }
            for item in items
        ],
    }
