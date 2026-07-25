"""Tenant-safe supplier actuals, with optional vendor-PO reconciliation."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import VendorInvoiceCreateRequest
from app.auth import require_permission
from app.budget_logic import decimal_amount
from app.db.tables import (
    activity_log,
    budget_lines,
    crm_companies,
    episodes,
    post_work_orders,
    purchase_order_allocations,
    purchase_orders,
    seasons,
    vendor_invoices,
)

router = APIRouter(prefix="/vendor-invoices", tags=["vendor-invoices"])


async def _purchase_order_actual_total(session: DbSession, actor: CurrentActor, purchase_order_id: str) -> Decimal:
    value = await session.scalar(
        select(func.coalesce(func.sum(purchase_order_allocations.c.amount), 0)).where(
            and_(
                purchase_order_allocations.c.organization_id == actor.organization_id,
                purchase_order_allocations.c.purchase_order_id == purchase_order_id,
                purchase_order_allocations.c.allocation_type == "vendor_invoice",
            )
        )
    )
    return decimal_amount(value)


@router.post("", status_code=status.HTTP_201_CREATED)
async def record_vendor_invoice(
    payload: VendorInvoiceCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Record a supplier actual and, when applicable, its PO allocation.

    A PO is optional by design.  When an external work order has selected one,
    this route verifies the supplier and episode scope before consuming it.
    """
    await require_permission(session, actor, "manage_commercial")
    vendor = (
        await session.execute(
            select(crm_companies.c.id, crm_companies.c.type).where(
                and_(
                    crm_companies.c.id == payload.vendor_company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not vendor or vendor.type != "vendor":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found.")
    episode = (
        await session.execute(
            select(episodes.c.id, seasons.c.id.label("season_id"), seasons.c.show_id)
            .join(
                seasons,
                and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
            )
            .where(and_(episodes.c.id == payload.episode_id, episodes.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")

    work_order = None
    if payload.work_order_id:
        work_order = (
            await session.execute(
                select(post_work_orders)
                .where(
                    and_(
                        post_work_orders.c.id == payload.work_order_id,
                        post_work_orders.c.organization_id == actor.organization_id,
                    )
                )
                .with_for_update()
                .limit(1)
            )
        ).first()
        if not work_order or str(work_order.episode_id) != str(episode.id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found for this episode.")
        if work_order.work_type != "external_vendor" or str(work_order.vendor_company_id or "") != str(vendor.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="The work order does not belong to this vendor."
            )
        if work_order.status in {"open", "awaiting_approval", "rejected", "cancelled"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Approve the vendor work order before recording its invoice.",
            )

    order = None
    if work_order and work_order.purchase_order_id:
        order = (
            await session.execute(
                select(purchase_orders)
                .where(
                    and_(
                        purchase_orders.c.id == work_order.purchase_order_id,
                        purchase_orders.c.organization_id == actor.organization_id,
                    )
                )
                .with_for_update()
                .limit(1)
            )
        ).first()
        if (
            not order
            or order.status not in {"approved", "closed"}
            or str(order.vendor_company_id) != str(vendor.id)
            or (order.show_id and str(order.show_id) != str(episode.show_id))
            or (order.episode_id and str(order.episode_id) != str(episode.id))
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The linked purchase order is not valid for this supplier invoice.",
            )
        actual = await _purchase_order_actual_total(session, actor, str(order.id))
        overrun = actual + Decimal(str(payload.amount)) - decimal_amount(order.approved_amount)
        if overrun > 0:
            if not payload.overrun_reason:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Explain the PO overrun before authorising it.",
                )
            await require_permission(session, actor, "approve_budget_overruns")

    now = datetime.now(UTC)
    invoice_date = payload.invoice_date or date.today()
    try:
        invoice_id = (
            await session.execute(
                insert(vendor_invoices)
                .values(
                    organization_id=actor.organization_id,
                    vendor_company_id=vendor.id,
                    work_order_id=work_order.id if work_order else None,
                    show_id=episode.show_id,
                    episode_id=episode.id,
                    invoice_number=payload.invoice_number.strip(),
                    description=payload.description.strip() if payload.description else None,
                    amount=payload.amount,
                    currency=actor.active_organization.currency,
                    status=payload.status,
                    invoice_date=payload.invoice_date,
                    due_date=payload.due_date,
                    external_document_url=payload.external_document_url,
                    created_at=now,
                    updated_at=now,
                )
                .returning(vendor_invoices.c.id)
            )
        ).scalar_one()
        budget_line_id = (
            await session.execute(
                insert(budget_lines)
                .values(
                    organization_id=actor.organization_id,
                    show_id=episode.show_id,
                    season_id=episode.season_id,
                    episode_id=episode.id,
                    vendor_invoice_id=invoice_id,
                    purchase_order_id=order.id if order else None,
                    external_cost=True,
                    category="Vendor invoice",
                    description=(f"{order.po_number} · " if order else "")
                    + f"{payload.invoice_number.strip()}"
                    + (f" · {payload.description.strip()}" if payload.description else ""),
                    budgeted_amount=0,
                    actual_amount=payload.amount,
                    currency=actor.active_organization.currency,
                    cost_type="internal",
                    created_at=now,
                    updated_at=now,
                )
                .returning(budget_lines.c.id)
            )
        ).scalar_one()
        allocation_id = None
        if order:
            allocation_id = (
                await session.execute(
                    insert(purchase_order_allocations)
                    .values(
                        organization_id=actor.organization_id,
                        purchase_order_id=order.id,
                        allocation_type="vendor_invoice",
                        vendor_invoice_id=invoice_id,
                        amount=payload.amount,
                        allocation_date=invoice_date,
                        reference=payload.invoice_number.strip(),
                        description=payload.description.strip() if payload.description else "Vendor invoice",
                        created_by_user_id=actor.user_id,
                        created_at=now,
                        updated_at=now,
                    )
                    .returning(purchase_order_allocations.c.id)
                )
            ).scalar_one()
        if work_order:
            await session.execute(
                update(post_work_orders)
                .where(
                    and_(
                        post_work_orders.c.id == work_order.id,
                        post_work_orders.c.organization_id == actor.organization_id,
                    )
                )
                .values(actual_amount=payload.amount, updated_at=now)
            )
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action="vendor_invoice.recorded",
                entity_type="vendor_invoice",
                entity_id=str(invoice_id),
                metadata={
                    "budgetLineId": str(budget_line_id),
                    "purchaseOrderId": str(order.id) if order else None,
                    "purchaseOrderAllocationId": str(allocation_id) if allocation_id else None,
                },
            )
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A supplier invoice with that reference already exists for this vendor.",
        ) from error
    return {
        "id": str(invoice_id),
        "budget_line_id": str(budget_line_id),
        "purchase_order_allocation_id": str(allocation_id) if allocation_id else None,
    }
