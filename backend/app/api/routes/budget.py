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
from sqlalchemy import and_, case, delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import BudgetLineCreateRequest, BudgetLineUpdateRequest
from app.auth import require_permission
from app.budget_logic import can_commit_po, cost_totals, decimal_amount, monetary
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
)
from app.purchase_order_logic import balance_snapshot

router = APIRouter(prefix="/budget", tags=["budget"])


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
            metadata=metadata,
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
    await _work_order_for_episode(session, actor, payload.work_order_id, payload.episode_id)
    order = await _purchase_order_for_episode(
        session,
        actor,
        purchase_order_id=payload.purchase_order_id,
        external_cost=payload.external_cost,
        episode=episode,
    )
    now = datetime.now(UTC)
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
                category=payload.category.strip(),
                description=payload.description.strip() if payload.description else None,
                budgeted_amount=payload.budgeted_amount,
                actual_amount=payload.actual_amount,
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
            category=payload.category.strip(),
            description=payload.description.strip() if payload.description else None,
            budgeted_amount=decimal_amount(payload.budgeted_amount),
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
                "category": payload.category.strip(),
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
    final_estimate = decimal_amount(payload.budgeted_amount if "budgeted_amount" in fields else line.budgeted_amount)
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
    final_category = payload.category.strip() if "category" in fields and payload.category else line.category
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
    if "budgeted_amount" in fields:
        values["budgeted_amount"] = payload.budgeted_amount
    if "actual_amount" in fields:
        values["actual_amount"] = payload.actual_amount
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
