"""Authoritative budget actual-allocation helpers.

`budget_lines.actual_amount` is a compatibility cache maintained by PostgreSQL.
All new spend enters through this ledger so a source can be audited and never
needs to be re-entered by a browser as a line total.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import and_, insert, select, update

from app.budget_logic import decimal_amount, money_amount
from app.db.tables import budget_actual_allocations, budget_lines


async def record_budget_actual(
    session,
    *,
    organization_id: str,
    actor_user_id: str | None,
    budget_line_id: str,
    source_type: str,
    amount: Decimal | int | str,
    currency: str,
    booking_id: str | None = None,
    booking_charge_component_id: str | None = None,
    work_order_id: str | None = None,
    vendor_invoice_id: str | None = None,
    manual_adjustment_reason: str | None = None,
    source_reference: str | None = None,
    allocation_date: date | None = None,
) -> str:
    """Create or update one immutable-source actual allocation.

    Bookings/time submissions, work orders and invoices each have a stable
    source id and can therefore be safely upserted. Manual adjustments are
    separate ledger entries and need an explanatory reason.
    """
    valid_sources = {
        "booking",
        "time_submission",
        "booking_component",
        "work_order",
        "vendor_invoice",
        "manual_adjustment",
    }
    if source_type not in valid_sources:
        raise ValueError("Unsupported budget actual source.")
    if decimal_amount(amount) < 0:
        raise ValueError("Budget actual allocations cannot be negative.")
    if source_type in {"booking", "time_submission"} and not booking_id:
        raise ValueError("A booking source requires a booking.")
    if source_type == "booking_component" and (not booking_id or not booking_charge_component_id):
        raise ValueError("A booking-component source requires its booking and commercial component.")
    if source_type == "work_order" and not work_order_id:
        raise ValueError("A work-order source requires a work order.")
    if source_type == "vendor_invoice" and not vendor_invoice_id:
        raise ValueError("An invoice source requires a vendor invoice.")
    if source_type == "manual_adjustment" and not (manual_adjustment_reason or "").strip():
        raise ValueError("A manual adjustment requires a reason.")

    line = (
        await session.execute(
            select(budget_lines.c.id)
            .where(and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == organization_id))
            .limit(1)
        )
    ).first()
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget line not found.")

    source_column = (
        budget_actual_allocations.c.booking_id
        if source_type in {"booking", "time_submission"}
        else budget_actual_allocations.c.booking_charge_component_id
        if source_type == "booking_component"
        else budget_actual_allocations.c.work_order_id
        if source_type == "work_order"
        else budget_actual_allocations.c.vendor_invoice_id
        if source_type == "vendor_invoice"
        else None
    )
    source_id = booking_charge_component_id or booking_id or work_order_id or vendor_invoice_id
    now = datetime.now(UTC)
    values = {
        "source_type": source_type,
        # Allocation is one of the defined monetary persistence boundaries.
        "amount": money_amount(amount),
        "currency": currency,
        "allocation_date": allocation_date or date.today(),
        "manual_adjustment_reason": manual_adjustment_reason.strip() if manual_adjustment_reason else None,
        "source_reference": source_reference.strip() if source_reference else None,
        "updated_at": now,
    }
    existing = None
    if source_column is not None and source_id:
        source_types = (
            ("booking", "time_submission") if source_type in {"booking", "time_submission"} else (source_type,)
        )
        existing = (
            await session.execute(
                select(
                    budget_actual_allocations.c.id,
                    budget_actual_allocations.c.budget_line_id,
                )
                .where(
                    and_(
                        budget_actual_allocations.c.organization_id == organization_id,
                        budget_actual_allocations.c.source_type.in_(source_types),
                        source_column == source_id,
                    )
                )
                .limit(1)
            )
        ).first()
    elif source_type == "manual_adjustment" and source_reference:
        existing = (
            await session.execute(
                select(
                    budget_actual_allocations.c.id,
                    budget_actual_allocations.c.budget_line_id,
                )
                .where(
                    and_(
                        budget_actual_allocations.c.organization_id == organization_id,
                        budget_actual_allocations.c.budget_line_id == budget_line_id,
                        budget_actual_allocations.c.source_type == source_type,
                        budget_actual_allocations.c.source_reference == source_reference,
                    )
                )
                .limit(1)
            )
        ).first()
    if existing:
        if str(existing.budget_line_id) != str(budget_line_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This actual source is already allocated to a different budget line.",
            )
        await session.execute(
            update(budget_actual_allocations)
            .where(
                and_(
                    budget_actual_allocations.c.id == existing.id,
                    budget_actual_allocations.c.organization_id == organization_id,
                )
            )
            .values(**values)
        )
        return str(existing.id)

    created = await session.execute(
        insert(budget_actual_allocations)
        .values(
            organization_id=organization_id,
            budget_line_id=budget_line_id,
            booking_id=booking_id,
            booking_charge_component_id=booking_charge_component_id,
            work_order_id=work_order_id,
            vendor_invoice_id=vendor_invoice_id,
            created_by_user_id=actor_user_id,
            created_at=now,
            **values,
        )
        .returning(budget_actual_allocations.c.id)
    )
    return str(created.scalar_one())
