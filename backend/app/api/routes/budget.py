"""Tenant-scoped episode cost ledger and live commercial rollups.

Budget lines are the cost ledger.  Supplier POs are an authorisation ledger:
their commitments are reported alongside cost totals but are never folded into
actual spend.  This prevents a vendor commitment and its later invoice from
being counted twice.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, case, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    BudgetEstimatePreviewRequest,
    BudgetEstimateRevisionCreateRequest,
    BudgetLineCreateRequest,
    BudgetLineUpdateRequest,
    BudgetManualActualAdjustmentRequest,
)
from app.auth import require_permission
from app.budget_actuals import record_budget_actual
from app.budget_logic import can_commit_po, cost_totals, decimal_amount, json_safe, monetary
from app.budget_rate_resolution import resolve_budget_rate_snapshot
from app.db.tables import (
    activity_log,
    bookings,
    budget_actual_allocations,
    budget_lines,
    crm_companies,
    episode_budget_estimate_items,
    episode_budget_estimates,
    episodes,
    people,
    post_work_orders,
    purchase_order_allocations,
    purchase_orders,
    rooms,
    seasons,
    service_rates,
    shows,
    vendor_invoices,
)
from app.purchase_order_logic import balance_snapshot

router = APIRouter(prefix="/budget", tags=["budget"])


def _stored_rate_resource(reference: str | None) -> tuple[str | None, str | None]:
    """Read the stable resource identity from a human-readable snapshot."""
    if not reference:
        return None, None
    identity = reference.split(" · ", 1)[0]
    resource_type, separator, resource_id = identity.partition(":")
    if separator and resource_type in {"service", "room", "person"} and resource_id:
        return resource_type, resource_id
    return None, None


async def _audit(
    session: DbSession,
    actor: CurrentActor,
    action: str,
    entity_id: str,
    metadata: dict[str, object],
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type="budget_line",
            entity_id=entity_id,
            metadata=json_safe(metadata),
        )
    )


async def _episode_scope(session: DbSession, actor: CurrentActor, episode_id: str) -> object:
    episode = (
        await session.execute(
            select(
                episodes.c.id,
                seasons.c.id.label("season_id"),
                shows.c.id.label("show_id"),
                shows.c.title.label("show_title"),
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


async def _vendor_reference(session: DbSession, actor: CurrentActor, vendor_company_id: str | None) -> str | None:
    if not vendor_company_id:
        return None
    vendor = (
        await session.execute(
            select(crm_companies.c.id, crm_companies.c.name)
            .where(
                and_(
                    crm_companies.c.id == vendor_company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                    crm_companies.c.type == "vendor",
                )
            )
            .limit(1)
        )
    ).first()
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found.")
    return f"vendor:{vendor.id} · {vendor.name}"


async def _preview_estimate(
    session: DbSession, actor: CurrentActor, payload: BudgetEstimatePreviewRequest
) -> dict[str, object]:
    await _episode_scope(session, actor, payload.episode_id)
    vendor_reference = await _vendor_reference(session, actor, payload.vendor_company_id)
    if payload.rate_resource_id:
        resolved = await resolve_budget_rate_snapshot(
            session,
            actor,
            episode_id=payload.episode_id,
            category=payload.category,
            quantity=payload.planned_quantity,
            unit=payload.planned_unit,
            resource_type=payload.rate_resource_type or "",
            resource_id=payload.rate_resource_id,
            manual_rate_override=payload.manual_rate_override,
            manual_override_reason=payload.manual_override_reason,
        )
        return {
            "category": resolved.category,
            "quantity": monetary(resolved.quantity),
            "unit": resolved.unit,
            "rate": monetary(resolved.rate),
            "estimate": monetary(resolved.estimate),
            "rate_source": resolved.source,
            "currency": resolved.currency,
            "resource_reference": resolved.resource_reference,
        }
    rate = decimal_amount(payload.manual_rate_override)
    return {
        "category": payload.category.strip(),
        "quantity": monetary(decimal_amount(payload.planned_quantity)),
        "unit": payload.planned_unit,
        "rate": monetary(rate),
        "estimate": monetary(decimal_amount(payload.planned_quantity) * rate),
        "rate_source": "manual_estimate",
        "currency": actor.active_organization.currency,
        "resource_reference": vendor_reference or "fixed_cost · Manual planned item",
    }


async def _show_or_404(session: DbSession, actor: CurrentActor, show_id: str) -> object:
    show = (
        await session.execute(
            select(shows.c.id, shows.c.title, shows.c.network)
            .where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not show:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    return show


@router.get("/options")
async def commercial_form_options(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """One tenant-scoped option set for commercial React forms.

    Budget users need the same show, episode, and account references as the
    browser forms, but never a browser-supplied organisation identifier.
    Keeping this small read model in FastAPI lets the frontend retire its
    Form loaders without broadening the client directory API.
    """
    await require_permission(session, actor, "manage_commercial")
    company_rows = (
        await session.execute(
            select(crm_companies.c.id, crm_companies.c.name, crm_companies.c.type)
            .where(crm_companies.c.organization_id == actor.organization_id)
            .order_by(crm_companies.c.name, crm_companies.c.id)
        )
    ).all()
    show_rows = (
        await session.execute(
            select(shows.c.id, shows.c.title, shows.c.network)
            .where(shows.c.organization_id == actor.organization_id)
            .order_by(shows.c.title, shows.c.id)
        )
    ).all()
    episode_rows = (
        await session.execute(
            select(
                episodes.c.id,
                episodes.c.number,
                episodes.c.title,
                seasons.c.show_id,
                shows.c.title.label("show_title"),
            )
            .select_from(episodes)
            .join(
                seasons,
                and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
            )
            .join(shows, and_(shows.c.id == seasons.c.show_id, shows.c.organization_id == actor.organization_id))
            .where(episodes.c.organization_id == actor.organization_id)
            .order_by(shows.c.title, seasons.c.number, episodes.c.number, episodes.c.id)
        )
    ).all()
    room_rows = (
        await session.execute(
            select(rooms.c.id, rooms.c.name, rooms.c.type)
            .where(rooms.c.organization_id == actor.organization_id)
            .order_by(rooms.c.name, rooms.c.id)
        )
    ).all()
    person_rows = (
        await session.execute(
            select(people.c.id, people.c.name, people.c.role)
            .where(people.c.organization_id == actor.organization_id)
            .order_by(people.c.name, people.c.id)
        )
    ).all()
    service_rows = (
        await session.execute(
            select(service_rates.c.id, service_rates.c.name, service_rates.c.category, service_rates.c.unit)
            .where(and_(service_rates.c.organization_id == actor.organization_id, service_rates.c.is_active.is_(True)))
            .order_by(service_rates.c.name, service_rates.c.id)
        )
    ).all()
    return {
        "companies": [{"id": str(item.id), "name": item.name, "type": item.type} for item in company_rows],
        "shows": [{"id": str(item.id), "title": item.title, "network": item.network} for item in show_rows],
        "episodes": [
            {
                "id": str(item.id),
                "show_id": str(item.show_id),
                "show_title": item.show_title,
                "number": item.number,
                "title": item.title,
            }
            for item in episode_rows
        ],
        "rooms": [{"id": str(item.id), "name": item.name, "type": item.type} for item in room_rows],
        "people": [{"id": str(item.id), "name": item.name, "role": item.role} for item in person_rows],
        "services": [
            {"id": str(item.id), "name": item.name, "category": item.category, "unit": item.unit}
            for item in service_rows
        ],
    }


async def _work_order_for_episode(
    session: DbSession, actor: CurrentActor, work_order_id: str | None, episode_id: str
) -> object | None:
    if not work_order_id:
        return None
    work_order = (
        await session.execute(
            select(post_work_orders.c.id, post_work_orders.c.episode_id, post_work_orders.c.title)
            .where(
                and_(
                    post_work_orders.c.id == work_order_id,
                    post_work_orders.c.organization_id == actor.organization_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not work_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found.")
    if str(work_order.episode_id) != episode_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The linked work order must belong to this episode.",
        )
    return work_order


async def _purchase_order_for_episode(
    session: DbSession,
    actor: CurrentActor,
    *,
    purchase_order_id: str | None,
    external_cost: bool,
    episode: object,
) -> object | None:
    if not purchase_order_id:
        return None
    if not external_cost:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only external-cost budget lines can be linked to a vendor PO.",
        )
    # Lock the PO while checking and changing its commitment. This serialises
    # two commercial users updating different budget lines against one PO.
    order = (
        await session.execute(
            select(purchase_orders)
            .where(
                and_(
                    purchase_orders.c.id == purchase_order_id,
                    purchase_orders.c.organization_id == actor.organization_id,
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")
    if order.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an approved PO can receive a budget commitment.",
        )
    if order.show_id and str(order.show_id) != str(episode.show_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This PO is for a different show.")
    if order.episode_id and str(order.episode_id) != str(episode.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This PO is for a different episode.")
    return order


async def _po_totals(session: DbSession, actor: CurrentActor, purchase_order_id: str) -> tuple[Decimal, Decimal]:
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
    return decimal_amount(row.committed), decimal_amount(row.actual)


async def _existing_allocation(session: DbSession, actor: CurrentActor, budget_line_id: str) -> object | None:
    return (
        await session.execute(
            select(purchase_order_allocations)
            .where(
                and_(
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                    purchase_order_allocations.c.budget_line_id == budget_line_id,
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()


async def _apply_po_commitment(
    session: DbSession,
    actor: CurrentActor,
    *,
    line_id: str,
    category: str,
    description: str | None,
    budgeted_amount: Decimal,
    order: object | None,
    existing: object | None,
    overrun_reason: str | None,
) -> None:
    """Create/update/release the one budget-line commitment, always live."""
    now = datetime.now(UTC)
    if order is None:
        if existing:
            await session.execute(
                delete(purchase_order_allocations).where(
                    and_(
                        purchase_order_allocations.c.id == existing.id,
                        purchase_order_allocations.c.organization_id == actor.organization_id,
                    )
                )
            )
            await session.execute(
                insert(activity_log).values(
                    organization_id=actor.organization_id,
                    actor_user_id=actor.user_id,
                    action="purchase_order.budget_line_commitment_released",
                    entity_type="purchase_order",
                    entity_id=str(existing.purchase_order_id),
                    metadata={"budgetLineId": line_id},
                )
            )
        return

    committed, _ = await _po_totals(session, actor, str(order.id))
    replacing_amount = (
        decimal_amount(existing.amount) if existing and str(existing.purchase_order_id) == str(order.id) else Decimal(0)
    )
    overrun = can_commit_po(
        approved_amount=decimal_amount(order.approved_amount),
        existing_committed=committed,
        replacing_amount=replacing_amount,
        next_amount=budgeted_amount,
    )
    if overrun > 0 and not (overrun_reason or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explain the PO overrun before authorising it.",
        )
    if existing:
        await session.execute(
            update(purchase_order_allocations)
            .where(
                and_(
                    purchase_order_allocations.c.id == existing.id,
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                )
            )
            .values(
                purchase_order_id=order.id,
                amount=budgeted_amount,
                description=description or category,
                updated_at=now,
            )
        )
    else:
        await session.execute(
            insert(purchase_order_allocations).values(
                organization_id=actor.organization_id,
                purchase_order_id=order.id,
                allocation_type="budget_line",
                budget_line_id=line_id,
                amount=budgeted_amount,
                allocation_date=date.today(),
                reference=f"Budget line {line_id[:8]}",
                description=description or category,
                created_by_user_id=actor.user_id,
                created_at=now,
                updated_at=now,
            )
        )
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="purchase_order.budget_line_overrun_authorised"
            if overrun > 0
            else "purchase_order.budget_line_committed",
            entity_type="purchase_order",
            entity_id=str(order.id),
            metadata={
                "budgetLineId": line_id,
                "amount": monetary(budgeted_amount),
                **({"overrunAmount": monetary(overrun), "reason": overrun_reason.strip()} if overrun > 0 else {}),
            },
        )
    )


async def _po_details_for_lines(
    session: DbSession, actor: CurrentActor, purchase_order_ids: set[str]
) -> dict[str, dict[str, object]]:
    if not purchase_order_ids:
        return {}
    rows = (
        await session.execute(
            select(purchase_orders).where(
                and_(
                    purchase_orders.c.organization_id == actor.organization_id,
                    purchase_orders.c.id.in_(purchase_order_ids),
                )
            )
        )
    ).all()
    result: dict[str, dict[str, object]] = {}
    for order in rows:
        committed, actual = await _po_totals(session, actor, str(order.id))
        result[str(order.id)] = {
            "id": str(order.id),
            "po_number": order.po_number,
            "status": order.status,
            "currency": order.currency,
            **{
                name: monetary(amount)
                for name, amount in balance_snapshot(decimal_amount(order.approved_amount), committed, actual).items()
            },
        }
    return result


async def _lines(
    session: DbSession, actor: CurrentActor, *, episode_id: str | None = None, show_id: str | None = None
) -> list[dict[str, object]]:
    conditions = [budget_lines.c.organization_id == actor.organization_id]
    if episode_id:
        conditions.append(budget_lines.c.episode_id == episode_id)
    if show_id:
        conditions.append(budget_lines.c.show_id == show_id)
    work_order = post_work_orders.alias("budget_work_order")
    rows = (
        await session.execute(
            select(
                budget_lines,
                work_order.c.title.label("work_order_title"),
                work_order.c.status.label("work_order_status"),
            )
            .outerjoin(
                work_order,
                and_(
                    work_order.c.id == budget_lines.c.work_order_id,
                    work_order.c.organization_id == actor.organization_id,
                ),
            )
            .where(and_(*conditions))
            .order_by(budget_lines.c.category, budget_lines.c.created_at, budget_lines.c.id)
        )
    ).all()
    po_details = await _po_details_for_lines(
        session,
        actor,
        {str(row.purchase_order_id) for row in rows if row.purchase_order_id},
    )
    return [
        {
            "id": str(row.id),
            "show_id": str(row.show_id) if row.show_id else None,
            "season_id": str(row.season_id) if row.season_id else None,
            "episode_id": str(row.episode_id) if row.episode_id else None,
            "code": row.code,
            "category": row.category,
            "description": row.description,
            "external_cost": row.external_cost,
            "cost_type": row.cost_type,
            "planned_quantity": (
                monetary(decimal_amount(row.planned_quantity)) if row.planned_quantity is not None else None
            ),
            "planned_unit": row.planned_unit,
            "rate_snapshot": monetary(decimal_amount(row.rate_snapshot)) if row.rate_snapshot is not None else None,
            "rate_source": row.rate_source,
            "resource_reference": row.resource_reference,
            "estimate_status": row.estimate_status,
            "manual_override_reason": row.manual_override_reason,
            "estimated_amount": monetary(decimal_amount(row.budgeted_amount)),
            "actual_amount": monetary(decimal_amount(row.actual_amount)),
            "variance_amount": monetary(decimal_amount(row.actual_amount) - decimal_amount(row.budgeted_amount)),
            "currency": row.currency,
            "work_order": {
                "id": str(row.work_order_id),
                "title": row.work_order_title,
                "status": row.work_order_status,
            }
            if row.work_order_id
            else None,
            "purchase_order": po_details.get(str(row.purchase_order_id)) if row.purchase_order_id else None,
            "vendor_invoice_id": str(row.vendor_invoice_id) if row.vendor_invoice_id else None,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


async def _summary(
    session: DbSession, actor: CurrentActor, *, episode_id: str | None = None, show_id: str | None = None
) -> dict[str, object]:
    raw_lines = await _lines(session, actor, episode_id=episode_id, show_id=show_id)

    # `cost_totals` intentionally needs only the live ledger attributes. A
    # tiny value object avoids trusting any response values re-sent by a UI.
    class _Line:
        def __init__(self, line: dict[str, object]) -> None:
            self.budgeted_amount = line["estimated_amount"]
            self.actual_amount = line["actual_amount"]
            self.external_cost = bool(line["external_cost"])

    totals = cost_totals(_Line(line) for line in raw_lines)
    po_details = {line["purchase_order"]["id"]: line["purchase_order"] for line in raw_lines if line["purchase_order"]}
    po_rollup = {
        "count": len(po_details),
        "authorised_amount": sum((decimal_amount(po["authorised_amount"]) for po in po_details.values()), Decimal(0)),
        "committed_amount": sum((decimal_amount(po["committed_amount"]) for po in po_details.values()), Decimal(0)),
        "actual_invoiced_amount": sum(
            (decimal_amount(po["actual_invoiced_amount"]) for po in po_details.values()), Decimal(0)
        ),
        "remaining_amount": sum((decimal_amount(po["remaining_amount"]) for po in po_details.values()), Decimal(0)),
    }
    return {
        "line_count": len(raw_lines),
        **{name: monetary(amount) for name, amount in totals.items()},
        "purchase_orders": {
            name: monetary(amount) if isinstance(amount, Decimal) else amount for name, amount in po_rollup.items()
        },
    }


async def _revision_rows(session: DbSession, actor: CurrentActor, episode_id: str) -> list[object]:
    return (
        await session.execute(
            select(episode_budget_estimates)
            .where(
                and_(
                    episode_budget_estimates.c.organization_id == actor.organization_id,
                    episode_budget_estimates.c.episode_id == episode_id,
                )
            )
            .order_by(episode_budget_estimates.c.revision_number.desc())
        )
    ).all()


async def _assert_plan_editable(session: DbSession, actor: CurrentActor, episode_id: str) -> None:
    """A published estimate is immutable until a named revision is opened."""
    rows = await _revision_rows(session, actor, episode_id)
    has_approved = any(row.status == "approved" for row in rows)
    has_draft = any(row.status == "draft" for row in rows)
    if has_approved and not has_draft:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This approved estimate is locked. Create a named estimate revision before changing planned costs.",
        )


async def _estimate_overview(session: DbSession, actor: CurrentActor, episode_id: str) -> dict[str, object]:
    rows = await _revision_rows(session, actor, episode_id)
    current = next((row for row in rows if row.status == "approved"), None)
    approved_history = sorted(
        (row for row in rows if row.status in {"approved", "superseded"}), key=lambda row: row.revision_number
    )
    original = approved_history[0] if approved_history else None
    draft = next((row for row in rows if row.status == "draft"), None)
    line_rows = (
        await session.execute(
            select(
                budget_lines.c.id, budget_lines.c.budgeted_amount, budget_lines.c.actual_amount, budget_lines.c.currency
            ).where(
                and_(budget_lines.c.organization_id == actor.organization_id, budget_lines.c.episode_id == episode_id)
            )
        )
    ).all()
    actual_by_line = {str(line.id): decimal_amount(line.actual_amount) for line in line_rows}
    actual = sum(actual_by_line.values(), Decimal(0))
    working_plan = sum((decimal_amount(line.budgeted_amount) for line in line_rows), Decimal(0))
    current_items: list[object] = []
    if current:
        current_items = (
            await session.execute(
                select(episode_budget_estimate_items).where(
                    and_(
                        episode_budget_estimate_items.c.organization_id == actor.organization_id,
                        episode_budget_estimate_items.c.estimate_id == current.id,
                    )
                )
            )
        ).all()
    current_approved = decimal_amount(current.approved_amount) if current else None
    # An open named revision is the active working plan. Its forecast should
    # respond to approved edits before it is frozen, while the current
    # approved snapshot remains visible separately for comparison.
    if current_items and not draft:
        remaining_planned = sum(
            (
                max(
                    Decimal(0),
                    decimal_amount(item.planned_amount)
                    - actual_by_line.get(str(item.source_budget_line_id), Decimal(0)),
                )
                for item in current_items
            ),
            Decimal(0),
        )
    else:
        remaining_planned = sum(
            (
                max(Decimal(0), decimal_amount(line.budgeted_amount) - decimal_amount(line.actual_amount))
                for line in line_rows
            ),
            Decimal(0),
        )
    forecast = actual + remaining_planned
    item_counts = {
        str(row.estimate_id): row.item_count
        for row in (
            await session.execute(
                select(
                    episode_budget_estimate_items.c.estimate_id,
                    func.count(episode_budget_estimate_items.c.id).label("item_count"),
                )
                .where(episode_budget_estimate_items.c.organization_id == actor.organization_id)
                .group_by(episode_budget_estimate_items.c.estimate_id)
            )
        ).all()
    }
    return {
        "original_estimate": monetary(decimal_amount(original.approved_amount)) if original else None,
        "current_approved_estimate": monetary(current_approved) if current_approved is not None else None,
        "working_estimate": monetary(working_plan),
        "actual": monetary(actual),
        "remaining_planned": monetary(remaining_planned),
        "forecast": monetary(forecast),
        "forecast_basis": "open_revision" if draft else "current_approved_estimate" if current else "working_plan",
        "variance": monetary(forecast - current_approved) if current_approved is not None else None,
        "is_locked": bool(current and not draft),
        "open_revision_id": str(draft.id) if draft else None,
        "currency": line_rows[0].currency if line_rows else actor.active_organization.currency,
        "revisions": [
            {
                "id": str(row.id),
                "revision_number": row.revision_number,
                "name": row.name,
                "reason": row.reason,
                "status": row.status,
                "approved_amount": monetary(decimal_amount(row.approved_amount))
                if row.approved_amount is not None
                else None,
                "approved_at": row.approved_at,
                "created_at": row.created_at,
                "item_count": item_counts.get(str(row.id), 0),
            }
            for row in sorted(rows, key=lambda row: row.revision_number, reverse=True)
        ],
    }


async def _approve_estimate_revision(
    session: DbSession, actor: CurrentActor, *, revision: object, episode_id: str
) -> None:
    """Freeze the current working ledger into an immutable revision snapshot."""
    now = datetime.now(UTC)
    lines = (
        await session.execute(
            select(budget_lines).where(
                and_(budget_lines.c.organization_id == actor.organization_id, budget_lines.c.episode_id == episode_id)
            )
        )
    ).all()
    approved_amount = sum((decimal_amount(line.budgeted_amount) for line in lines), Decimal(0))
    await session.execute(
        update(episode_budget_estimates)
        .where(
            and_(
                episode_budget_estimates.c.organization_id == actor.organization_id,
                episode_budget_estimates.c.episode_id == episode_id,
                episode_budget_estimates.c.status == "approved",
            )
        )
        .values(status="superseded", updated_at=now)
    )
    for line in lines:
        await session.execute(
            insert(episode_budget_estimate_items).values(
                organization_id=actor.organization_id,
                estimate_id=revision.id,
                source_budget_line_id=line.id,
                category=line.category,
                description=line.description,
                external_cost=line.external_cost,
                planned_amount=line.budgeted_amount,
                currency=line.currency,
                created_at=now,
            )
        )
    await session.execute(
        update(episode_budget_estimates)
        .where(
            and_(
                episode_budget_estimates.c.id == revision.id,
                episode_budget_estimates.c.organization_id == actor.organization_id,
                episode_budget_estimates.c.status == "draft",
            )
        )
        .values(
            status="approved",
            approved_amount=approved_amount,
            approved_by_user_id=actor.user_id,
            approved_at=now,
            updated_at=now,
        )
    )
    await session.execute(
        update(budget_lines)
        .where(and_(budget_lines.c.organization_id == actor.organization_id, budget_lines.c.episode_id == episode_id))
        .values(estimate_status="approved", updated_at=now)
    )
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action="budget_estimate_revision.approved",
            entity_type="episode_budget_estimate",
            entity_id=str(revision.id),
            metadata={
                "episodeId": episode_id,
                "revisionNumber": revision.revision_number,
                "approvedAmount": monetary(approved_amount),
            },
        )
    )


async def _episode_operational_ledger(session: DbSession, actor: CurrentActor, episode_id: str) -> dict[str, object]:
    """Expose the sources behind every commercial number for one episode.

    This is intentionally a read model: it joins the allocation ledger to
    operational records without asking the browser to reconstruct or total
    money.  All links are tenant-scoped even when a source was later removed.
    """
    line_rows = await _lines(session, actor, episode_id=episode_id)
    allocation_rows = (
        await session.execute(
            select(
                budget_actual_allocations,
                budget_lines.c.category.label("budget_category"),
                budget_lines.c.description.label("budget_description"),
            )
            .join(
                budget_lines,
                and_(
                    budget_lines.c.id == budget_actual_allocations.c.budget_line_id,
                    budget_lines.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    budget_actual_allocations.c.organization_id == actor.organization_id,
                    budget_lines.c.episode_id == episode_id,
                )
            )
            .order_by(
                budget_actual_allocations.c.allocation_date.desc(),
                budget_actual_allocations.c.created_at.desc(),
                budget_actual_allocations.c.id.desc(),
            )
        )
    ).all()
    booking_ids = [row.booking_id for row in allocation_rows if row.booking_id]
    work_order_ids = [row.work_order_id for row in allocation_rows if row.work_order_id]
    invoice_ids = [row.vendor_invoice_id for row in allocation_rows if row.vendor_invoice_id]
    booking_rows = []
    if booking_ids:
        booking_rows = (
            await session.execute(
                select(
                    bookings.c.id,
                    bookings.c.title,
                    bookings.c.actual_starts_at,
                    bookings.c.actual_ends_at,
                    bookings.c.approved_overtime_minutes,
                    rooms.c.name.label("room_name"),
                    people.c.name.label("person_name"),
                    post_work_orders.c.id.label("linked_work_order_id"),
                    post_work_orders.c.title.label("linked_work_order_title"),
                    post_work_orders.c.status.label("linked_work_order_status"),
                )
                .outerjoin(
                    rooms, and_(rooms.c.id == bookings.c.room_id, rooms.c.organization_id == actor.organization_id)
                )
                .outerjoin(
                    people, and_(people.c.id == bookings.c.person_id, people.c.organization_id == actor.organization_id)
                )
                .outerjoin(
                    post_work_orders,
                    and_(
                        post_work_orders.c.booking_id == bookings.c.id,
                        post_work_orders.c.organization_id == actor.organization_id,
                    ),
                )
                .where(and_(bookings.c.organization_id == actor.organization_id, bookings.c.id.in_(booking_ids)))
            )
        ).all()
    work_order_rows = []
    if work_order_ids:
        work_order_rows = (
            await session.execute(
                select(post_work_orders.c.id, post_work_orders.c.title, post_work_orders.c.status).where(
                    and_(
                        post_work_orders.c.organization_id == actor.organization_id,
                        post_work_orders.c.id.in_(work_order_ids),
                    )
                )
            )
        ).all()
    invoice_rows = []
    if invoice_ids:
        invoice_rows = (
            await session.execute(
                select(
                    vendor_invoices.c.id,
                    vendor_invoices.c.invoice_number,
                    vendor_invoices.c.description,
                    vendor_invoices.c.invoice_date,
                    vendor_invoices.c.status,
                ).where(
                    and_(
                        vendor_invoices.c.organization_id == actor.organization_id,
                        vendor_invoices.c.id.in_(invoice_ids),
                    )
                )
            )
        ).all()
    bookings_by_id = {str(row.id): row for row in booking_rows}
    work_orders_by_id = {str(row.id): row for row in work_order_rows}
    invoices_by_id = {str(row.id): row for row in invoice_rows}

    actuals = []
    for row in allocation_rows:
        booking = bookings_by_id.get(str(row.booking_id)) if row.booking_id else None
        work_order = work_orders_by_id.get(str(row.work_order_id)) if row.work_order_id else None
        invoice = invoices_by_id.get(str(row.vendor_invoice_id)) if row.vendor_invoice_id else None
        actuals.append(
            {
                "id": str(row.id),
                "amount": monetary(decimal_amount(row.amount)),
                "currency": row.currency,
                "allocation_date": row.allocation_date,
                "source_type": row.source_type,
                "reference": row.source_reference,
                "reason": row.manual_adjustment_reason,
                "budget_item": {
                    "id": str(row.budget_line_id),
                    "category": row.budget_category,
                    "description": row.budget_description,
                },
                "booking": {
                    "id": str(booking.id),
                    "title": booking.title,
                    "room_name": booking.room_name,
                    "person_name": booking.person_name,
                }
                if booking
                else None,
                "time_submission": {
                    "actual_starts_at": booking.actual_starts_at,
                    "actual_ends_at": booking.actual_ends_at,
                    "approved_overtime_minutes": booking.approved_overtime_minutes,
                }
                if booking and row.source_type in {"booking", "time_submission"}
                else None,
                "work_order": {
                    "id": str(work_order.id),
                    "title": work_order.title,
                    "status": work_order.status,
                }
                if work_order
                else {
                    "id": str(booking.linked_work_order_id),
                    "title": booking.linked_work_order_title,
                    "status": booking.linked_work_order_status,
                }
                if booking and booking.linked_work_order_id
                else None,
                "vendor_invoice": {
                    "id": str(invoice.id),
                    "invoice_number": invoice.invoice_number,
                    "description": invoice.description,
                    "invoice_date": invoice.invoice_date,
                    "status": invoice.status,
                }
                if invoice
                else None,
            }
        )

    unallocated_rows = (
        await session.execute(
            select(
                bookings.c.id,
                bookings.c.title,
                bookings.c.actual_starts_at,
                bookings.c.actual_ends_at,
                bookings.c.approved_overtime_minutes,
                rooms.c.name.label("room_name"),
                people.c.name.label("person_name"),
                budget_lines.c.id.label("budget_line_id"),
                budget_lines.c.category.label("budget_category"),
                budget_lines.c.description.label("budget_description"),
                budget_lines.c.rate_snapshot,
                budget_lines.c.planned_unit,
            )
            .outerjoin(rooms, and_(rooms.c.id == bookings.c.room_id, rooms.c.organization_id == actor.organization_id))
            .outerjoin(
                people, and_(people.c.id == bookings.c.person_id, people.c.organization_id == actor.organization_id)
            )
            .outerjoin(
                budget_lines,
                and_(
                    budget_lines.c.id == bookings.c.budget_line_id,
                    budget_lines.c.organization_id == actor.organization_id,
                ),
            )
            .where(
                and_(
                    bookings.c.organization_id == actor.organization_id,
                    bookings.c.episode_id == episode_id,
                    bookings.c.actual_starts_at.is_not(None),
                    bookings.c.actual_ends_at.is_not(None),
                    or_(
                        bookings.c.budget_line_id.is_(None),
                        budget_lines.c.rate_snapshot.is_(None),
                        budget_lines.c.planned_unit.is_(None),
                    ),
                )
            )
            .order_by(bookings.c.actual_starts_at.desc(), bookings.c.id)
        )
    ).all()
    return {
        "estimate_items": line_rows,
        "actuals": actuals,
        "unallocated_actuals": [
            {
                "booking_id": str(row.id),
                "booking_title": row.title,
                "room_name": row.room_name,
                "person_name": row.person_name,
                "actual_starts_at": row.actual_starts_at,
                "actual_ends_at": row.actual_ends_at,
                "approved_overtime_minutes": row.approved_overtime_minutes,
                "selected_budget_item": {
                    "id": str(row.budget_line_id),
                    "category": row.budget_category,
                    "description": row.budget_description,
                }
                if row.budget_line_id
                else None,
                "reason": "The booking has no selected budget item."
                if not row.budget_line_id
                else "The selected budget item has no saved rate snapshot.",
            }
            for row in unallocated_rows
        ],
    }


@router.get("/lines")
async def list_budget_lines(
    actor: CurrentActor,
    session: DbSession,
    episode_id: str | None = Query(default=None),
    show_id: str | None = Query(default=None),
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    if episode_id:
        episode = await _episode_scope(session, actor, episode_id)
        if show_id and show_id != str(episode.show_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="The episode belongs to a different show."
            )
    if show_id:
        await _show_or_404(session, actor, show_id)
    return {"budget_lines": await _lines(session, actor, episode_id=episode_id, show_id=show_id)}


@router.post("/estimate-preview")
async def preview_budget_estimate(
    payload: BudgetEstimatePreviewRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Resolve one builder row without persisting or trusting browser totals."""
    await require_permission(session, actor, "manage_commercial")
    return await _preview_estimate(session, actor, payload)


@router.get("/episodes/{episode_id}/summary")
async def episode_budget_summary(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    episode = await _episode_scope(session, actor, episode_id)
    return {
        "episode_id": str(episode.id),
        "show_id": str(episode.show_id),
        "show_title": episode.show_title,
        "summary": await _summary(session, actor, episode_id=episode_id),
    }


@router.get("/episodes/{episode_id}/estimate-overview")
async def episode_estimate_overview(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return the immutable estimate history and live forecast for one episode."""
    await require_permission(session, actor, "manage_commercial")
    episode = await _episode_scope(session, actor, episode_id)
    return {
        "episode_id": str(episode.id),
        "show_id": str(episode.show_id),
        "estimate": await _estimate_overview(session, actor, episode_id),
    }


@router.get("/episodes/{episode_id}/operational-ledger")
async def episode_operational_ledger(episode_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """The traceable estimate, actual, and unallocated-actual sources for an episode."""
    await require_permission(session, actor, "manage_commercial")
    episode = await _episode_scope(session, actor, episode_id)
    return {
        "episode_id": str(episode.id),
        "show_id": str(episode.show_id),
        "ledger": await _episode_operational_ledger(session, actor, episode_id),
    }


@router.post("/episodes/{episode_id}/estimate-revisions", status_code=status.HTTP_201_CREATED)
async def create_estimate_revision(
    episode_id: str,
    payload: BudgetEstimateRevisionCreateRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    """Open a named estimate revision; optionally approve the first estimate."""
    await require_permission(session, actor, "manage_commercial")
    await _episode_scope(session, actor, episode_id)
    rows = await _revision_rows(session, actor, episode_id)
    if any(row.status == "draft" for row in rows):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is already an open estimate revision for this episode.",
        )
    has_approved_history = any(row.status in {"approved", "superseded"} for row in rows)
    if payload.approve_immediately and has_approved_history:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approve a new revision using the revision approval action.",
        )
    now = datetime.now(UTC)
    created = await session.execute(
        insert(episode_budget_estimates)
        .values(
            organization_id=actor.organization_id,
            episode_id=episode_id,
            revision_number=max((row.revision_number for row in rows), default=0) + 1,
            name=payload.name.strip(),
            reason=payload.reason.strip(),
            status="draft",
            created_by_user_id=actor.user_id,
            created_at=now,
            updated_at=now,
        )
        .returning(episode_budget_estimates)
    )
    revision = created.first()
    assert revision is not None
    await _audit(
        session,
        actor,
        "budget_estimate_revision.created",
        str(revision.id),
        {"episodeId": episode_id, "revisionNumber": revision.revision_number, "name": revision.name},
    )
    if payload.approve_immediately:
        await _approve_estimate_revision(session, actor, revision=revision, episode_id=episode_id)
    await session.commit()
    return {"estimate": await _estimate_overview(session, actor, episode_id)}


@router.post("/episodes/{episode_id}/estimate-revisions/{revision_id}/approve")
async def approve_estimate_revision(
    episode_id: str, revision_id: str, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Freeze an open revision as the episode's current approved estimate."""
    await require_permission(session, actor, "manage_commercial")
    await _episode_scope(session, actor, episode_id)
    revision = (
        await session.execute(
            select(episode_budget_estimates)
            .where(
                and_(
                    episode_budget_estimates.c.id == revision_id,
                    episode_budget_estimates.c.organization_id == actor.organization_id,
                    episode_budget_estimates.c.episode_id == episode_id,
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not revision:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estimate revision not found.")
    if revision.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only an open estimate revision can be approved."
        )
    await _approve_estimate_revision(session, actor, revision=revision, episode_id=episode_id)
    await session.commit()
    return {"estimate": await _estimate_overview(session, actor, episode_id)}


@router.get("/shows/{show_id}/summary")
async def show_budget_summary(show_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    show = await _show_or_404(session, actor, show_id)
    return {
        "show_id": str(show.id),
        "show_title": show.title,
        "summary": await _summary(session, actor, show_id=show_id),
    }


@router.post("/lines", status_code=status.HTTP_201_CREATED)
async def create_budget_line(
    payload: BudgetLineCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    episode = await _episode_scope(session, actor, payload.episode_id)
    await _assert_plan_editable(session, actor, payload.episode_id)
    await _work_order_for_episode(session, actor, payload.work_order_id, payload.episode_id)
    order = await _purchase_order_for_episode(
        session,
        actor,
        purchase_order_id=payload.purchase_order_id,
        external_cost=payload.external_cost,
        episode=episode,
    )
    now = datetime.now(UTC)
    preview = None
    if payload.rate_resource_id or payload.manual_rate_override is not None:
        if payload.planned_quantity is None or payload.planned_unit is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A rate-resolved budget item needs quantity and unit.",
            )
        preview = await _preview_estimate(
            session,
            actor,
            BudgetEstimatePreviewRequest(
                episode_id=payload.episode_id,
                category=payload.category,
                planned_quantity=payload.planned_quantity,
                planned_unit=payload.planned_unit,
                rate_resource_type=payload.rate_resource_type,
                rate_resource_id=payload.rate_resource_id,
                manual_rate_override=payload.manual_rate_override,
                manual_override_reason=payload.manual_override_reason,
                vendor_company_id=payload.vendor_company_id,
            ),
        )
    elif payload.vendor_company_id:
        await _vendor_reference(session, actor, payload.vendor_company_id)
    try:
        created = await session.execute(
            insert(budget_lines)
            .values(
                organization_id=actor.organization_id,
                show_id=episode.show_id,
                season_id=episode.season_id,
                episode_id=episode.id,
                work_order_id=payload.work_order_id,
                purchase_order_id=order.id if order else None,
                external_cost=payload.external_cost,
                code=payload.code.strip() if payload.code else None,
                category=str(preview["category"]) if preview else payload.category.strip(),
                description=payload.description.strip() if payload.description else None,
                budgeted_amount=preview["estimate"] if preview else payload.budgeted_amount,
                planned_quantity=preview["quantity"] if preview else payload.planned_quantity,
                planned_unit=preview["unit"] if preview else payload.planned_unit,
                rate_snapshot=preview["rate"] if preview else None,
                rate_source=preview["rate_source"] if preview else None,
                resource_reference=preview["resource_reference"] if preview else None,
                estimate_status=payload.estimate_status,
                manual_override_reason=(
                    payload.manual_override_reason.strip() if payload.manual_override_reason else None
                ),
                actual_amount=0,
                currency=actor.active_organization.currency,
                cost_type=payload.cost_type,
                created_at=now,
                updated_at=now,
            )
            .returning(budget_lines.c.id)
        )
        line_id = str(created.scalar_one())
        await _apply_po_commitment(
            session,
            actor,
            line_id=line_id,
            category=str(preview["category"]) if preview else payload.category.strip(),
            description=payload.description.strip() if payload.description else None,
            budgeted_amount=decimal_amount(preview["estimate"]) if preview else decimal_amount(payload.budgeted_amount),
            order=order,
            existing=None,
            overrun_reason=payload.overrun_reason,
        )
        await _audit(
            session,
            actor,
            "budget_line.created",
            line_id,
            {
                "episodeId": payload.episode_id,
                "externalCost": payload.external_cost,
                "category": str(preview["category"]) if preview else payload.category.strip(),
                "rateSource": preview["rate_source"] if preview else None,
            },
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That work order is already linked to a budget line.",
        ) from error
    lines = await _lines(session, actor, episode_id=payload.episode_id)
    return next(line for line in lines if line["id"] == line_id)


@router.patch("/lines/{budget_line_id}")
async def update_budget_line(
    budget_line_id: str, payload: BudgetLineUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_commercial")
    line = (
        await session.execute(
            select(budget_lines)
            .where(and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == actor.organization_id))
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget line not found.")
    if line.vendor_invoice_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A supplier-invoice budget line is managed by its invoice record.",
        )
    episode = await _episode_scope(session, actor, str(line.episode_id))
    await _assert_plan_editable(session, actor, str(line.episode_id))
    fields = payload.model_fields_set
    final_external_cost = payload.external_cost if "external_cost" in fields else line.external_cost
    final_po_id = (
        payload.purchase_order_id
        if "purchase_order_id" in fields
        else (str(line.purchase_order_id) if line.purchase_order_id else None)
    )
    final_work_order_id = (
        payload.work_order_id
        if "work_order_id" in fields
        else (str(line.work_order_id) if line.work_order_id else None)
    )
    stored_resource_type, stored_resource_id = _stored_rate_resource(line.resource_reference)
    resource_type = payload.rate_resource_type if "rate_resource_type" in fields else stored_resource_type
    resource_id = payload.rate_resource_id if "rate_resource_id" in fields else stored_resource_id
    if bool(resource_type) != bool(resource_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose both a budget resource type and resource.",
        )
    needs_snapshot = bool(resource_id) and bool(
        {"rate_resource_type", "rate_resource_id", "planned_quantity", "planned_unit", "manual_rate_override"} & fields
        or ("estimate_status" in fields and payload.estimate_status == "approved")
    )
    rate_snapshot = None
    if needs_snapshot:
        rate_snapshot = await resolve_budget_rate_snapshot(
            session,
            actor,
            episode_id=str(line.episode_id),
            category=payload.category if "category" in fields and payload.category else line.category,
            quantity=payload.planned_quantity if "planned_quantity" in fields else line.planned_quantity or 1,
            unit=payload.planned_unit if "planned_unit" in fields else line.planned_unit,
            resource_type=resource_type or "",
            resource_id=resource_id or "",
            manual_rate_override=payload.manual_rate_override,
            manual_override_reason=(
                payload.manual_override_reason if "manual_override_reason" in fields else line.manual_override_reason
            ),
        )
    final_estimate = (
        rate_snapshot.estimate
        if rate_snapshot
        else decimal_amount(payload.budgeted_amount if "budgeted_amount" in fields else line.budgeted_amount)
    )
    if final_po_id and final_estimate <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A PO-linked cost line needs a positive estimate.",
        )
    await _work_order_for_episode(session, actor, final_work_order_id, str(line.episode_id))
    order = await _purchase_order_for_episode(
        session,
        actor,
        purchase_order_id=final_po_id,
        external_cost=bool(final_external_cost),
        episode=episode,
    )
    existing = await _existing_allocation(session, actor, budget_line_id)
    final_category = (
        rate_snapshot.category
        if rate_snapshot
        else (payload.category.strip() if "category" in fields and payload.category else line.category)
    )
    final_description = (
        payload.description.strip() if payload.description else None if "description" in fields else line.description
    )
    values: dict[str, object] = {"updated_at": datetime.now(UTC), "purchase_order_id": order.id if order else None}
    if "category" in fields:
        values["category"] = final_category
    if "description" in fields:
        values["description"] = final_description
    if "code" in fields:
        values["code"] = payload.code.strip() if payload.code else None
    if "external_cost" in fields:
        values["external_cost"] = payload.external_cost
    if "cost_type" in fields:
        values["cost_type"] = payload.cost_type
    if "budgeted_amount" in fields and not rate_snapshot:
        values["budgeted_amount"] = payload.budgeted_amount
    for field in (
        "planned_quantity",
        "planned_unit",
        "estimate_status",
        "manual_override_reason",
    ):
        if field in fields:
            value = getattr(payload, field)
            values[field] = value.strip() if isinstance(value, str) else value
    if rate_snapshot:
        values.update(
            category=rate_snapshot.category,
            budgeted_amount=rate_snapshot.estimate,
            planned_quantity=rate_snapshot.quantity,
            planned_unit=rate_snapshot.unit,
            rate_snapshot=rate_snapshot.rate,
            rate_source=rate_snapshot.source,
            resource_reference=rate_snapshot.resource_reference,
        )
    if "work_order_id" in fields:
        values["work_order_id"] = payload.work_order_id
    try:
        await session.execute(
            update(budget_lines)
            .where(and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == actor.organization_id))
            .values(**values)
        )
        await _apply_po_commitment(
            session,
            actor,
            line_id=budget_line_id,
            category=final_category,
            description=final_description,
            budgeted_amount=final_estimate,
            order=order,
            existing=existing,
            overrun_reason=payload.overrun_reason,
        )
        await _audit(
            session,
            actor,
            "budget_line.updated",
            budget_line_id,
            {"episodeId": str(line.episode_id), "externalCost": bool(final_external_cost), "category": final_category},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That work order is already linked to a budget line.",
        ) from error
    lines = await _lines(session, actor, episode_id=str(line.episode_id))
    return next(item for item in lines if item["id"] == budget_line_id)


@router.get("/lines/{budget_line_id}/actual-allocations")
async def list_budget_actual_allocations(
    budget_line_id: str, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Return the audit-backed sources behind a calculated line actual."""
    await require_permission(session, actor, "manage_commercial")
    rows = (
        await session.execute(
            select(budget_actual_allocations)
            .where(
                and_(
                    budget_actual_allocations.c.organization_id == actor.organization_id,
                    budget_actual_allocations.c.budget_line_id == budget_line_id,
                )
            )
            .order_by(budget_actual_allocations.c.allocation_date, budget_actual_allocations.c.created_at)
        )
    ).all()
    if not rows:
        exists = await session.scalar(
            select(budget_lines.c.id).where(
                and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == actor.organization_id)
            )
        )
        if not exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget line not found.")
    return {
        "actual_allocations": [
            {
                "id": str(row.id),
                "source_type": row.source_type,
                "booking_id": str(row.booking_id) if row.booking_id else None,
                "work_order_id": str(row.work_order_id) if row.work_order_id else None,
                "vendor_invoice_id": str(row.vendor_invoice_id) if row.vendor_invoice_id else None,
                "reason": row.manual_adjustment_reason,
                "reference": row.source_reference,
                "amount": monetary(decimal_amount(row.amount)),
                "currency": row.currency,
                "allocation_date": row.allocation_date,
            }
            for row in rows
        ]
    }


@router.post("/lines/{budget_line_id}/manual-actual-adjustments", status_code=status.HTTP_201_CREATED)
async def create_budget_manual_actual_adjustment(
    budget_line_id: str,
    payload: BudgetManualActualAdjustmentRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    """Record an exceptional, traceable actual rather than editing a total."""
    await require_permission(session, actor, "manage_commercial")
    allocation_id = await record_budget_actual(
        session,
        organization_id=actor.organization_id,
        actor_user_id=actor.user_id,
        budget_line_id=budget_line_id,
        source_type="manual_adjustment",
        amount=payload.amount,
        currency=actor.active_organization.currency,
        manual_adjustment_reason=payload.reason,
        source_reference=payload.reference,
        allocation_date=payload.allocation_date,
    )
    await _audit(
        session,
        actor,
        "budget_line.actual_adjustment_recorded",
        budget_line_id,
        {"allocationId": allocation_id, "amount": payload.amount, "reason": payload.reason},
    )
    await session.commit()
    lines = await _lines(session, actor)
    return next(line for line in lines if line["id"] == budget_line_id)


@router.delete("/lines/{budget_line_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget_line(budget_line_id: str, actor: CurrentActor, session: DbSession) -> None:
    """Remove a manual cost line and its one derived PO commitment safely."""
    await require_permission(session, actor, "manage_commercial")
    line = (
        await session.execute(
            select(budget_lines)
            .where(and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == actor.organization_id))
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget line not found.")
    if line.vendor_invoice_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A supplier-invoice budget line is managed by its invoice record.",
        )
    await _assert_plan_editable(session, actor, str(line.episode_id))
    if decimal_amount(line.actual_amount) != 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A budget line with recorded actuals cannot be deleted. "
                "Keep it for the audit trail or create a revision."
            ),
        )
    allocation = await _existing_allocation(session, actor, budget_line_id)
    if allocation:
        await session.execute(
            delete(purchase_order_allocations).where(
                and_(
                    purchase_order_allocations.c.id == allocation.id,
                    purchase_order_allocations.c.organization_id == actor.organization_id,
                )
            )
        )
        await session.execute(
            insert(activity_log).values(
                organization_id=actor.organization_id,
                actor_user_id=actor.user_id,
                action="purchase_order.budget_line_commitment_released",
                entity_type="purchase_order",
                entity_id=str(allocation.purchase_order_id),
                metadata={"budgetLineId": budget_line_id, "reason": "Budget line deleted"},
            )
        )
    await session.execute(
        delete(budget_lines).where(
            and_(budget_lines.c.id == budget_line_id, budget_lines.c.organization_id == actor.organization_id)
        )
    )
    await _audit(
        session,
        actor,
        "budget_line.deleted",
        budget_line_id,
        {"episodeId": str(line.episode_id), "category": line.category},
    )
    await session.commit()
