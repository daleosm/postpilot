"""Tenant-safe supplier actuals, with optional vendor-PO reconciliation."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import VendorInvoiceCreateRequest, VendorInvoiceUpdateRequest
from app.auth import require_permission
from app.budget_actuals import record_budget_actual
from app.budget_logic import decimal_amount, json_safe
from app.db.tables import (
    activity_log,
    budget_actual_allocations,
    budget_lines,
    crm_companies,
    episodes,
    post_work_orders,
    purchase_order_allocations,
    purchase_orders,
    seasons,
    vendor_invoices,
)
from app.vendor_spend import external_budget_line_for_episode

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

    selected_budget_line_id = payload.budget_line_id
    if work_order and work_order.budget_line_id:
        if selected_budget_line_id and str(selected_budget_line_id) != str(work_order.budget_line_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The supplier invoice must use the work order's external budget item.",
            )
        selected_budget_line_id = str(work_order.budget_line_id)

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
        overrun = actual + decimal_amount(payload.amount) - decimal_amount(order.approved_amount)
        if overrun > 0:
            if not payload.overrun_reason:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Explain the PO overrun before authorising it.",
                )
            await require_permission(session, actor, "approve_budget_overruns")

    budget_line = await external_budget_line_for_episode(
        session,
        organization_id=actor.organization_id,
        episode_id=str(episode.id),
        budget_line_id=selected_budget_line_id,
        purchase_order_id=str(order.id) if order else None,
    )
    # The budget item remains the actual-cost ledger. Retaining an optional PO
    # reference only gives episode and show summaries authorisation context;
    # it does not create a second commitment or actual allocation.
    if order and not budget_line.purchase_order_id:
        await session.execute(
            update(budget_lines)
            .where(
                and_(
                    budget_lines.c.id == budget_line.id,
                    budget_lines.c.organization_id == actor.organization_id,
                )
            )
            .values(purchase_order_id=order.id, updated_at=datetime.now(UTC))
        )

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
                    budget_line_id=budget_line.id,
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
        await record_budget_actual(
            session,
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            budget_line_id=str(budget_line.id),
            source_type="vendor_invoice",
            vendor_invoice_id=str(invoice_id),
            amount=payload.amount,
            currency=actor.active_organization.currency,
            source_reference=payload.invoice_number.strip(),
            allocation_date=invoice_date,
        )
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
            work_order_actual = await session.scalar(
                select(func.coalesce(func.sum(vendor_invoices.c.amount), 0)).where(
                    and_(
                        vendor_invoices.c.organization_id == actor.organization_id,
                        vendor_invoices.c.work_order_id == work_order.id,
                        vendor_invoices.c.status != "void",
                    )
                )
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
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action="vendor_invoice.recorded",
                entity_type="vendor_invoice",
                entity_id=str(invoice_id),
                metadata=json_safe({
                    "budgetLineId": str(budget_line.id),
                    "purchaseOrderId": str(order.id) if order else None,
                    "purchaseOrderAllocationId": str(allocation_id) if allocation_id else None,
                }),
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
        "budget_line_id": str(budget_line.id),
        "purchase_order_allocation_id": str(allocation_id) if allocation_id else None,
    }


@router.patch("/{invoice_id}")
async def update_vendor_invoice(
    invoice_id: str, payload: VendorInvoiceUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Correct one supplier invoice without ever creating a second actual.

    The vendor invoice is the stable source identity. Its related budget and
    PO rows are updated in-place, so the visible delta is exactly the change
    in invoice value rather than an additional cost allocation.
    """
    await require_permission(session, actor, "manage_commercial")
    invoice = (
        await session.execute(
            select(vendor_invoices)
            .where(and_(vendor_invoices.c.id == invoice_id, vendor_invoices.c.organization_id == actor.organization_id))
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor invoice not found.")
    if invoice.status == "paid" and ("amount" in payload.model_fields_set or payload.status == "void"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A paid supplier invoice cannot be amended; record a supplier credit instead.",
        )

    next_status = payload.status or invoice.status
    next_amount = Decimal(0) if next_status == "void" else decimal_amount(payload.amount or invoice.amount)
    po_allocation = (
        await session.execute(
            select(purchase_order_allocations)
            .where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.vendor_invoice_id == invoice_id,
                    purchase_order_allocations.c.allocation_type == "vendor_invoice",
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()
    if po_allocation:
        order = (
            await session.execute(
                select(purchase_orders)
                .where(
                    and_(
                        purchase_orders.c.id == po_allocation.purchase_order_id,
                        purchase_orders.c.organization_id == actor.organization_id,
                    )
                )
                .with_for_update()
                .limit(1)
            )
        ).first()
        if not order:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The linked vendor PO is unavailable.")
        other_actuals = await session.scalar(
            select(func.coalesce(func.sum(purchase_order_allocations.c.amount), 0)).where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.purchase_order_id == order.id,
                    purchase_order_allocations.c.allocation_type == "vendor_invoice",
                    purchase_order_allocations.c.id != po_allocation.id,
                )
            )
        )
        overrun = decimal_amount(other_actuals) + next_amount - decimal_amount(order.approved_amount)
        if overrun > 0:
            if not payload.overrun_reason:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Explain the PO overrun before saving it.")
            await require_permission(session, actor, "approve_budget_overruns")

    now = datetime.now(UTC)
    values = payload.model_dump(exclude_unset=True)
    values.pop("overrun_reason", None)
    if "invoice_number" in values:
        values["invoice_number"] = values["invoice_number"].strip()
    if "description" in values and values["description"]:
        values["description"] = values["description"].strip()
    values["updated_at"] = now
    changed = await session.execute(
        update(vendor_invoices)
        .where(and_(vendor_invoices.c.id == invoice_id, vendor_invoices.c.organization_id == actor.organization_id))
        .values(**values)
        .returning(vendor_invoices)
    )
    row = changed.one()
    await session.execute(
        update(budget_actual_allocations)
        .where(
            and_(
                budget_actual_allocations.c.organization_id == actor.organization_id,
                budget_actual_allocations.c.vendor_invoice_id == invoice_id,
                budget_actual_allocations.c.source_type == "vendor_invoice",
            )
        )
        .values(amount=next_amount, source_reference=row.invoice_number, updated_at=now)
    )
    if po_allocation:
        await session.execute(
            update(purchase_order_allocations)
            .where(
                and_(
                    purchase_order_allocations.c.id == po_allocation.id,
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                )
            )
            .values(amount=next_amount, reference=row.invoice_number, description=row.description, updated_at=now)
        )
    if row.work_order_id:
        total = await session.scalar(
            select(func.coalesce(func.sum(vendor_invoices.c.amount), 0)).where(
                and_(
                    vendor_invoices.c.organization_id == actor.organization_id,
                    vendor_invoices.c.work_order_id == row.work_order_id,
                    vendor_invoices.c.status != "void",
                )
            )
        )
        await session.execute(
            update(post_work_orders)
            .where(
                and_(
                    post_work_orders.c.id == row.work_order_id,
                    post_work_orders.c.organization_id == actor.organization_id,
                )
            )
            .values(actual_amount=decimal_amount(total), updated_at=now)
        )
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="vendor_invoice.corrected" if next_status != "void" else "vendor_invoice.voided",
            entity_type="vendor_invoice",
            entity_id=invoice_id,
            metadata=json_safe({"previousAmount": str(invoice.amount), "actualAmount": str(next_amount)}),
        )
    )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Supplier invoice reference already exists.") from error
    return {"id": str(row.id), "amount": decimal_amount(row.amount), "status": row.status, "actual_amount": next_amount}
